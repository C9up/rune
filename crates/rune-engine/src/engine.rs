//! Validation engine — validates data against a schema description.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

/// Email regex — compiled once.
static EMAIL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").unwrap());

/// UUID regex — case-insensitive, matches the TS `UUID_RE` exactly.
static UUID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap()
});

/// JavaScript's `Number(string)`, for the spellings a body can carry.
///
/// Rust's `f64` parser is not the same function: it does not read the `0x` /
/// `0b` / `0o` prefixes that JS does, so `"0x10"` came back refused here while
/// the TypeScript path — which calls `Number()` and is the upstream behaviour —
/// coerced it to 16. Same schema, same input, two verdicts, decided by whether
/// the application happened to install a messages provider.
///
/// Every step mirrors the ECMAScript `StringToNumber` grammar:
/// - the white space trimmed is JS's (`js_whitespace`), not Rust's `trim()`;
/// - a radix body is digits only — no sign, never empty (`u128::from_str_radix`
///   took `"0x+10"`, which JS reads as `NaN`);
/// - a radix body of any length is read, correctly rounded, as JS does — a
///   `u128` refused anything wider than 128 bits.
///
/// It also accepts a few spellings JS does not (`"inf"`, `"nan"`), which need
/// no special case: both are non-finite and the caller refuses those anyway.
fn js_number(text: &str) -> Option<f64> {
    let trimmed = text.trim_matches(js_whitespace);
    // A radix prefix takes no sign in JS, so anything else falls through to the
    // ordinary parser — which is what rejects `"-0x10"`, as JS does.
    let radix_bits = match trimmed.get(..2) {
        Some(prefix) if prefix.eq_ignore_ascii_case("0x") => Some(4),
        Some(prefix) if prefix.eq_ignore_ascii_case("0b") => Some(1),
        Some(prefix) if prefix.eq_ignore_ascii_case("0o") => Some(3),
        _ => None,
    };
    match radix_bits {
        Some(bits) => parse_power_of_two_radix(&trimmed[2..], bits),
        None => trimmed.parse::<f64>().ok(),
    }
}

/// ECMAScript `WhiteSpace` + `LineTerminator`, the set `String.prototype.trim`
/// and `Number()` strip. Rust's `White_Space` property differs on two code
/// points: it lacks U+FEFF (ZWNBSP, a JS white space) and has U+0085 (NEL, a
/// control character JS keeps).
fn js_whitespace(c: char) -> bool {
    c == '\u{FEFF}' || (c != '\u{85}' && c.is_whitespace())
}

/// A radix-2/8/16 integer body (`bits` per digit), rounded to the nearest
/// `f64` with ties to even — what JS's `Number("0x…")` returns, for any width.
/// `None` for an empty body or any character that is not a digit of the radix.
fn parse_power_of_two_radix(body: &str, bits: u32) -> Option<f64> {
    let radix = 1u32 << bits;
    if body.is_empty() {
        return None;
    }
    // The top 64 significant bits, then a sticky flag for any set bit below.
    let mut mantissa: u64 = 0;
    let mut width: u32 = 0; // significant bits seen so far
    let mut sticky = false;
    for c in body.chars() {
        let digit = c.to_digit(radix)?;
        for shift in (0..bits).rev() {
            let bit = u64::from((digit >> shift) & 1);
            if width == 0 && bit == 0 {
                continue; // leading zero
            }
            if width < 64 {
                mantissa = (mantissa << 1) | bit;
            } else if bit == 1 {
                sticky = true;
            }
            width = width.saturating_add(1);
        }
    }
    if width <= 64 {
        // Exact integer: `as` rounds to nearest, ties to even.
        return Some(mantissa as f64);
    }
    // 64 > 53 + 1, so folding the sticky bit into the lowest kept bit leaves the
    // rounding of the cast exact. Scaling by a power of two is exact too, up to
    // the overflow to infinity JS also produces.
    let kept = mantissa | u64::from(sticky);
    let exponent = i32::try_from(width - 64).unwrap_or(i32::MAX);
    Some(kept as f64 * 2f64.powi(exponent))
}

/// Code-point length for a string, element count for an array, else `-1`.
/// Mirrors the TS `sizedLength` helper, which documents why code points and
/// not UTF-16 units (a named deviation from upstream).
fn sized_length(value: &serde_json::Value) -> i64 {
    match value {
        serde_json::Value::String(s) => s.chars().count() as i64,
        serde_json::Value::Array(a) => a.len() as i64,
        _ => -1,
    }
}

/// Membership test mirroring TS `asPrimitive(v)` + `values.includes(...)`.
/// Only string/number/boolean values can be members; any non-primitive
/// (object/array/null) is NEVER a member. Numbers compare by numeric value so
/// integer/float representations of the same number match (JS SameValueZero).
fn is_member(value: &serde_json::Value, values: &[serde_json::Value]) -> bool {
    match value {
        serde_json::Value::String(_) | serde_json::Value::Bool(_) => {
            values.iter().any(|x| x == value)
        }
        serde_json::Value::Number(_) => {
            let n = match value.as_f64() {
                Some(n) => n,
                None => return false,
            };
            values
                .iter()
                .any(|x| x.as_f64().map(|v| v == n).unwrap_or(false))
        }
        _ => false,
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleDefinition {
    pub name: String,
    #[serde(default)]
    pub params: serde_json::Value, // e.g., { "min": 3 } or { "max": 100 }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSchema {
    pub rules: Vec<RuleDefinition>,
    #[serde(default)]
    pub optional: bool,
    /// Stop at this field's first failing rule (upstream `FieldOptions.bail`,
    /// which defaults to `true`). Defaults to `true` here too so a payload
    /// omitting the flag behaves like upstream rather than reporting every rule.
    #[serde(default = "default_bail")]
    pub bail: bool,
}

/// serde default for [`FieldSchema::bail`] — upstream bails per field by default.
/// Character check backing `alpha` / `alphaNumeric`, honouring the upstream
/// options. These rules are in STANDARD_RULES, so a schema using them is routed
/// here — implementing the options only on the TS side would have made them
/// silently inert whenever the native binary was loadable.
fn alpha_matches(value: &str, params: &serde_json::Value, numeric: bool) -> bool {
    let flag = |name: &str| {
        params
            .get(name)
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    };
    let allow_spaces = flag("allowSpaces");
    let allow_underscores = flag("allowUnderscores");
    let allow_dashes = flag("allowDashes");
    value.chars().all(|c| {
        c.is_ascii_alphabetic()
            || (numeric && c.is_ascii_digit())
            || (allow_spaces && c == ' ')
            || (allow_underscores && c == '_')
            || (allow_dashes && c == '-')
    })
}

fn default_bail() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationRequest {
    pub schema: std::collections::HashMap<String, FieldSchema>,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationError {
    pub field: String,
    pub rule: String,
    pub message: String,
    /// Position of the failing rule in the field's `rules`. A field may carry
    /// the same rule twice (`min(3).min(5)`), and the caller renders the
    /// message from THAT rule's arguments, not from the first of that name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_index: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
    pub data: Option<serde_json::Value>,
}

/// Validate data against a schema.
pub fn validate(request: &ValidationRequest) -> ValidationResult {
    // Check input is an object
    let data_obj = match request.data.as_object() {
        Some(obj) => obj,
        None => {
            return ValidationResult {
                valid: false,
                errors: vec![err("_root", "type", "Input must be an object")],
                data: None,
            };
        }
    };

    let mut errors = Vec::new();
    let mut validated = serde_json::Map::new();

    for (field, schema) in &request.schema {
        let value = data_obj.get(field);

        // Check required
        if value.is_none() || value == Some(&serde_json::Value::Null) {
            if schema.optional {
                continue;
            }
            errors.push(err(field, "required", &format!("{} is required", field)));
            continue;
        }

        let mut val = value.unwrap().clone();

        // Coerce before validating, mirroring the TS path: upstream accepts "32"
        // for a number and "on"/"true" for a boolean unless the rule is strict.
        // Both engines must agree, otherwise the same schema behaves differently
        // depending on whether the native binary happened to load.
        for rule in &schema.rules {
            let strict = rule
                .params
                .get("strict")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            if strict {
                continue;
            }
            match rule.name.as_str() {
                "number" => {
                    if let Some(text) = val.as_str() {
                        if let Some(n) = js_number(text) {
                            if let Some(num) = serde_json::Number::from_f64(n) {
                                val = serde_json::Value::Number(num);
                            }
                        }
                    }
                }
                "boolean" => {
                    let coerced = match &val {
                        // The list is exact: no trim, no case folding. Doing
                        // either accepted "TRUE", " true " and "off", none of
                        // which the TypeScript path takes — and the two paths
                        // must agree, or the same schema decides differently
                        // depending on whether the native binary loaded.
                        serde_json::Value::String(text) => match text.as_str() {
                            "true" | "on" | "1" => Some(true),
                            "false" | "0" => Some(false),
                            _ => None,
                        },
                        serde_json::Value::Number(n) => match n.as_i64() {
                            Some(1) => Some(true),
                            Some(0) => Some(false),
                            _ => None,
                        },
                        _ => None,
                    };
                    if let Some(b) = coerced {
                        val = serde_json::Value::Bool(b);
                    }
                }
                _ => {}
            }
        }

        // Validate rules
        let mut field_valid = true;
        let mut type_failed = false;
        for (index, rule) in schema.rules.iter().enumerate() {
            let is_type_rule = matches!(rule.name.as_str(), "string" | "number" | "boolean");
            if !is_type_rule && type_failed {
                break;
            }
            // Bail mode: this field already failed, so stop rather than piling on.
            // Type rules are exempt — they gate the loop through `type_failed`.
            if schema.bail && !field_valid && !is_type_rule {
                break;
            }
            let error = validate_rule(&rule.name, &rule.params, &val, field);
            if let Some(mut err) = error {
                err.rule_index = Some(index);
                errors.push(err);
                field_valid = false;
                if is_type_rule {
                    type_failed = true;
                }
            }
        }

        if field_valid {
            validated.insert(field.clone(), val);
        }
    }

    errors.sort_by(|a, b| a.field.cmp(&b.field));
    let valid = errors.is_empty();
    ValidationResult {
        valid,
        errors,
        data: if valid {
            Some(serde_json::Value::Object(validated))
        } else {
            None
        },
    }
}

fn validate_rule(
    name: &str,
    params: &serde_json::Value,
    value: &serde_json::Value,
    field: &str,
) -> Option<ValidationError> {
    match name {
        "string" => {
            if !value.is_string() {
                return Some(err(field, "string", "Must be a string"));
            }
        }
        "number" => match value {
            serde_json::Value::Number(n) => {
                if let Some(f) = n.as_f64() {
                    if f.is_nan() || f.is_infinite() {
                        return Some(err(field, "number", "Must be a number"));
                    }
                }
            }
            _ => return Some(err(field, "number", "Must be a number")),
        },
        "boolean" => {
            if !value.is_boolean() {
                return Some(err(field, "boolean", "Must be a boolean"));
            }
        }
        "min" => {
            let min = match params.get("min").and_then(|v| v.as_f64()) {
                Some(v) => v,
                None => return Some(err(field, "min", "Invalid min rule: missing parameter")),
            };
            if let Some(s) = value.as_str() {
                // Count Unicode code points, not UTF-8 bytes — the TS path
                // counts code points too (`sizedLength`), and the two engines
                // must agree on multi-byte strings for the SAME schema.
                //
                // Bound the walk to `ceil(min)` code points — that's enough to
                // decide `< min`, so a pathologically long string can't force a
                // full O(n) scan. Defense-in-depth: Ream already caps body size
                // upstream, but this keeps rune cheap when used standalone.
                let cap = min.ceil().max(0.0) as usize;
                if (s.chars().take(cap).count() as f64) < min {
                    return Some(err(field, "min", &format!("Minimum {}", min)));
                }
            } else if let Some(n) = value.as_f64() {
                if n < min {
                    return Some(err(field, "min", &format!("Minimum {}", min)));
                }
            } else {
                // Fail closed: a min constraint on a value that is neither a
                // sized string nor a number can't be satisfied. The previous
                // fall-through returned None (PASS), so `min` without a type
                // rule silently accepted arrays/objects/booleans.
                return Some(err(field, "min", "Must be a string or number"));
            }
        }
        "max" => {
            let max = match params.get("max").and_then(|v| v.as_f64()) {
                Some(v) => v,
                None => return Some(err(field, "max", "Invalid max rule: missing parameter")),
            };
            if let Some(s) = value.as_str() {
                // Code-point count to match the TS fallback (see `min`). Bound
                // the walk to `floor(max) + 1` points — enough to detect `> max`
                // without scanning a pathologically long string in full.
                let cap = (max.floor().max(0.0) as usize).saturating_add(1);
                if (s.chars().take(cap).count() as f64) > max {
                    return Some(err(field, "max", &format!("Maximum {}", max)));
                }
            } else if let Some(n) = value.as_f64() {
                if n > max {
                    return Some(err(field, "max", &format!("Maximum {}", max)));
                }
            } else {
                // Fail closed — see `min`.
                return Some(err(field, "max", "Must be a string or number"));
            }
        }
        "email" => {
            if let Some(s) = value.as_str() {
                if s.contains('\n') || s.contains('\r') || !EMAIL_RE.is_match(s) {
                    return Some(err(field, "email", "Must be a valid email"));
                }
            } else {
                return Some(err(field, "email", "Must be a valid email"));
            }
        }
        "positive" => {
            if let Some(n) = value.as_f64() {
                if !n.is_finite() || n <= 0.0 {
                    return Some(err(field, "positive", "Must be positive"));
                }
            } else {
                return Some(err(field, "positive", "Must be positive"));
            }
        }
        "minLength" => {
            let min = match params.get("min").and_then(|v| v.as_f64()) {
                Some(v) => v,
                None => {
                    return Some(err(
                        field,
                        "minLength",
                        "Invalid minLength rule: missing parameter",
                    ))
                }
            };
            if (sized_length(value) as f64) < min {
                return Some(err(
                    field,
                    "minLength",
                    &format!("Must have at least {} characters", min),
                ));
            }
        }
        "maxLength" => {
            let max = match params.get("max").and_then(|v| v.as_f64()) {
                Some(v) => v,
                None => {
                    return Some(err(
                        field,
                        "maxLength",
                        "Invalid maxLength rule: missing parameter",
                    ))
                }
            };
            let len = sized_length(value);
            if !(len >= 0 && (len as f64) <= max) {
                return Some(err(
                    field,
                    "maxLength",
                    &format!("Must not exceed {} characters", max),
                ));
            }
        }
        "fixedLength" => {
            let size = match params.get("size").and_then(|v| v.as_f64()) {
                Some(v) => v,
                None => {
                    return Some(err(
                        field,
                        "fixedLength",
                        "Invalid fixedLength rule: missing parameter",
                    ))
                }
            };
            if (sized_length(value) as f64) != size {
                return Some(err(
                    field,
                    "fixedLength",
                    &format!("Must be exactly {} characters", size),
                ));
            }
        }
        "uuid" => match value.as_str() {
            Some(s) if UUID_RE.is_match(s) => {}
            _ => return Some(err(field, "uuid", "Must be a valid UUID")),
        },
        "alpha" => match value.as_str() {
            Some(s) if !s.is_empty() && alpha_matches(s, params, false) => {}
            _ => return Some(err(field, "alpha", "Must contain only letters")),
        },
        "alphaNumeric" => match value.as_str() {
            Some(s) if !s.is_empty() && alpha_matches(s, params, true) => {}
            _ => {
                return Some(err(
                    field,
                    "alphaNumeric",
                    "Must contain only letters and numbers",
                ))
            }
        },
        "startsWith" => {
            let substring = params.get("substring").and_then(|v| v.as_str());
            match (value.as_str(), substring) {
                (Some(s), Some(sub)) if s.starts_with(sub) => {}
                _ => {
                    return Some(err(
                        field,
                        "startsWith",
                        &format!("Must start with {}", substring.unwrap_or_default()),
                    ))
                }
            }
        }
        "endsWith" => {
            let substring = params.get("substring").and_then(|v| v.as_str());
            match (value.as_str(), substring) {
                (Some(s), Some(sub)) if s.ends_with(sub) => {}
                _ => {
                    return Some(err(
                        field,
                        "endsWith",
                        &format!("Must end with {}", substring.unwrap_or_default()),
                    ))
                }
            }
        }
        "in" | "enum" => {
            let values = params.get("values").and_then(|v| v.as_array());
            let ok = values.map(|vs| is_member(value, vs)).unwrap_or(false);
            if !ok {
                return Some(err(field, name, "Invalid value"));
            }
        }
        "notIn" => {
            let values = match params.get("values").and_then(|v| v.as_array()) {
                Some(vs) => vs,
                None => return Some(err(field, "notIn", "Invalid notIn rule: missing parameter")),
            };
            if is_member(value, values) {
                return Some(err(field, "notIn", "Invalid value"));
            }
        }
        "negative" => match value.as_f64() {
            Some(n) if n.is_finite() && n < 0.0 => {}
            _ => return Some(err(field, "negative", "Must be negative")),
        },
        "nonNegative" => match value.as_f64() {
            Some(n) if n.is_finite() && n >= 0.0 => {}
            _ => return Some(err(field, "nonNegative", "Must be positive or zero")),
        },
        "range" => {
            let min = params.get("min").and_then(|v| v.as_f64());
            let max = params.get("max").and_then(|v| v.as_f64());
            let (min, max) = match (min, max) {
                (Some(mn), Some(mx)) => (mn, mx),
                _ => return Some(err(field, "range", "Invalid range rule: missing parameter")),
            };
            match value.as_f64() {
                Some(n) if n.is_finite() && n >= min && n <= max => {}
                _ => {
                    return Some(err(
                        field,
                        "range",
                        &format!("Must be between {} and {}", min, max),
                    ))
                }
            }
        }
        _ => {
            // Unknown rule — skip (custom rules handled in TS)
        }
    }
    None
}

fn err(field: &str, rule: &str, message: &str) -> ValidationError {
    ValidationError {
        field: field.to_string(),
        rule: rule.to_string(),
        message: message.to_string(),
        rule_index: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_request(
        schema: HashMap<String, FieldSchema>,
        data: serde_json::Value,
    ) -> ValidationRequest {
        ValidationRequest { schema, data }
    }

    #[test]
    fn js_number_refuses_a_signed_or_empty_radix_body() {
        for text in ["0x+10", "0b+1", "0o+7", "0x-1", "0x", "0b", "0x1g"] {
            assert_eq!(js_number(text), None, "{text}");
        }
        assert_eq!(js_number("0x10"), Some(16.0));
        assert_eq!(js_number("0B101"), Some(5.0));
        assert_eq!(js_number("0o17"), Some(15.0));
    }

    #[test]
    fn js_number_trims_the_javascript_white_space_set() {
        assert_eq!(js_number("\u{FEFF}12"), Some(12.0));
        assert_eq!(js_number("12\u{FEFF}"), Some(12.0));
        assert_eq!(js_number("\u{3000}12\u{2028}"), Some(12.0));
        // NEL is Unicode White_Space but not JS white space.
        assert_eq!(js_number("\u{85}12"), None);
    }

    #[test]
    fn js_number_reads_radix_strings_wider_than_128_bits() {
        // 2^160 - 1 rounds to 2^160.
        assert_eq!(
            js_number(&format!("0x{}", "f".repeat(40))),
            Some(2f64.powi(160))
        );
        // 2^53 + 1 ties to even (2^53); a set bit below breaks the tie upward.
        assert_eq!(js_number("0x20000000000001"), Some(2f64.powi(53)));
        assert_eq!(
            js_number(&format!("0x20000000000001{}1", "0".repeat(20))),
            Some((2f64.powi(53) + 2.0) * 2f64.powi(84))
        );
        // Past f64: infinite, which the caller refuses — as JS's `Infinity`.
        assert_eq!(
            js_number(&format!("0x{}", "f".repeat(300))),
            Some(f64::INFINITY)
        );
    }

    #[test]
    fn test_valid_data() {
        let mut schema = HashMap::new();
        schema.insert(
            "name".to_string(),
            FieldSchema {
                bail: false,
                rules: vec![
                    RuleDefinition {
                        name: "string".to_string(),
                        params: serde_json::json!(null),
                    },
                    RuleDefinition {
                        name: "min".to_string(),
                        params: serde_json::json!({"min": 3}),
                    },
                ],
                optional: false,
            },
        );
        schema.insert(
            "email".to_string(),
            FieldSchema {
                bail: false,
                rules: vec![
                    RuleDefinition {
                        name: "string".to_string(),
                        params: serde_json::json!(null),
                    },
                    RuleDefinition {
                        name: "email".to_string(),
                        params: serde_json::json!(null),
                    },
                ],
                optional: false,
            },
        );

        let req = make_request(
            schema,
            serde_json::json!({"name": "Kaen", "email": "kaen@c9up.com"}),
        );
        let result = validate(&req);
        assert!(result.valid);
        assert!(result.data.is_some());
    }

    #[test]
    fn test_invalid_data() {
        let mut schema = HashMap::new();
        schema.insert(
            "name".to_string(),
            FieldSchema {
                bail: false,
                rules: vec![
                    RuleDefinition {
                        name: "string".to_string(),
                        params: serde_json::json!(null),
                    },
                    RuleDefinition {
                        name: "min".to_string(),
                        params: serde_json::json!({"min": 3}),
                    },
                ],
                optional: false,
            },
        );

        let req = make_request(schema, serde_json::json!({"name": "Ka"}));
        let result = validate(&req);
        assert!(!result.valid);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].rule, "min");
    }

    #[test]
    fn test_required_field() {
        let mut schema = HashMap::new();
        schema.insert(
            "name".to_string(),
            FieldSchema {
                bail: false,
                rules: vec![RuleDefinition {
                    name: "string".to_string(),
                    params: serde_json::json!(null),
                }],
                optional: false,
            },
        );

        let req = make_request(schema, serde_json::json!({}));
        let result = validate(&req);
        assert!(!result.valid);
        assert_eq!(result.errors[0].rule, "required");
    }

    #[test]
    fn test_optional_field() {
        let mut schema = HashMap::new();
        schema.insert(
            "bio".to_string(),
            FieldSchema {
                bail: false,
                rules: vec![RuleDefinition {
                    name: "string".to_string(),
                    params: serde_json::json!(null),
                }],
                optional: true,
            },
        );

        let req = make_request(schema, serde_json::json!({}));
        let result = validate(&req);
        assert!(result.valid);
    }

    #[test]
    fn test_error_names_the_rule_that_failed() {
        let mut schema = HashMap::new();
        schema.insert(
            "age".to_string(),
            FieldSchema {
                bail: true,
                rules: vec![
                    RuleDefinition {
                        name: "number".to_string(),
                        params: serde_json::json!({"strict": true}),
                    },
                    RuleDefinition {
                        name: "min".to_string(),
                        params: serde_json::json!({"min": 3}),
                    },
                    RuleDefinition {
                        name: "min".to_string(),
                        params: serde_json::json!({"min": 5}),
                    },
                ],
                optional: false,
            },
        );

        let req = make_request(schema, serde_json::json!({"age": 4}));
        let result = validate(&req);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].rule, "min");
        assert_eq!(result.errors[0].rule_index, Some(2));
    }

    #[test]
    fn test_email_rejects_newline() {
        let mut schema = HashMap::new();
        schema.insert(
            "email".to_string(),
            FieldSchema {
                bail: false,
                rules: vec![RuleDefinition {
                    name: "email".to_string(),
                    params: serde_json::json!(null),
                }],
                optional: false,
            },
        );

        let req = make_request(schema, serde_json::json!({"email": "test@test.com\n"}));
        let result = validate(&req);
        assert!(!result.valid);
    }

    #[test]
    fn test_positive_rejects_infinity() {
        let mut schema = HashMap::new();
        schema.insert(
            "amount".to_string(),
            FieldSchema {
                bail: false,
                rules: vec![
                    RuleDefinition {
                        name: "number".to_string(),
                        params: serde_json::json!(null),
                    },
                    RuleDefinition {
                        name: "positive".to_string(),
                        params: serde_json::json!(null),
                    },
                ],
                optional: false,
            },
        );

        // JSON doesn't have Infinity so this tests a normal negative
        let req = make_request(schema, serde_json::json!({"amount": -5}));
        let result = validate(&req);
        assert!(!result.valid);
    }

    #[test]
    fn test_non_object_input() {
        let schema = HashMap::new();
        let req = make_request(schema, serde_json::json!("not an object"));
        let result = validate(&req);
        assert!(!result.valid);
        assert_eq!(result.errors[0].field, "_root");
    }

    #[test]
    fn test_number_type_check() {
        let mut schema = HashMap::new();
        schema.insert(
            "age".to_string(),
            FieldSchema {
                bail: false,
                rules: vec![RuleDefinition {
                    name: "number".to_string(),
                    params: serde_json::json!(null),
                }],
                optional: false,
            },
        );

        let req = make_request(schema, serde_json::json!({"age": "not a number"}));
        let result = validate(&req);
        assert!(!result.valid);
        assert_eq!(result.errors[0].rule, "number");
    }

    #[test]
    fn test_min_fails_closed_on_non_sized_value() {
        // `min` without a preceding type rule must REJECT an array/object/bool
        // (previously it fell through to PASS — fail-open).
        let mut schema = HashMap::new();
        schema.insert(
            "q".to_string(),
            FieldSchema {
                bail: false,
                rules: vec![RuleDefinition {
                    name: "min".to_string(),
                    params: serde_json::json!({"min": 3}),
                }],
                optional: false,
            },
        );
        let req = make_request(schema, serde_json::json!({"q": [1, 2, 3, 4, 5]}));
        let result = validate(&req);
        assert!(!result.valid, "min on an array must fail closed");
        assert_eq!(result.errors[0].rule, "min");
    }

    #[test]
    fn test_min_max_counts_code_points_not_bytes() {
        // "é" is 2 UTF-8 bytes but 1 code point. With byte counting, max=1
        // would wrongly reject it. Code-point counting (matching the TS
        // fallback's [...str].length) accepts it.
        let mut schema = HashMap::new();
        schema.insert(
            "s".to_string(),
            FieldSchema {
                bail: false,
                rules: vec![
                    RuleDefinition {
                        name: "string".to_string(),
                        params: serde_json::json!(null),
                    },
                    RuleDefinition {
                        name: "max".to_string(),
                        params: serde_json::json!({"max": 1}),
                    },
                ],
                optional: false,
            },
        );
        let req = make_request(schema, serde_json::json!({"s": "é"}));
        assert!(validate(&req).valid, "one code point must satisfy max=1");
    }

    #[test]
    fn test_boolean_type_check() {
        let mut schema = HashMap::new();
        schema.insert(
            "active".to_string(),
            FieldSchema {
                bail: false,
                rules: vec![RuleDefinition {
                    name: "boolean".to_string(),
                    params: serde_json::json!(null),
                }],
                optional: false,
            },
        );

        let req = make_request(schema, serde_json::json!({"active": "yes"}));
        let result = validate(&req);
        assert!(!result.valid);

        let req2 = make_request(
            {
                let mut s = HashMap::new();
                s.insert(
                    "active".to_string(),
                    FieldSchema {
                        bail: false,
                        rules: vec![RuleDefinition {
                            name: "boolean".to_string(),
                            params: serde_json::json!(null),
                        }],
                        optional: false,
                    },
                );
                s
            },
            serde_json::json!({"active": true}),
        );
        assert!(validate(&req2).valid);
    }

    #[test]
    fn bail_stops_at_the_first_failing_rule() {
        // upstream bails per field by default; the engine must agree with the TS
        // path, otherwise the same schema reports differently depending on
        // whether the native binary happened to be loadable.
        let mut schema = HashMap::new();
        schema.insert(
            "code".to_string(),
            FieldSchema {
                bail: true,
                rules: vec![
                    RuleDefinition {
                        name: "string".to_string(),
                        params: serde_json::Value::Null,
                    },
                    RuleDefinition {
                        name: "minLength".to_string(),
                        params: serde_json::json!({ "min": 5 }),
                    },
                    RuleDefinition {
                        name: "alphaNumeric".to_string(),
                        params: serde_json::Value::Null,
                    },
                ],
                optional: false,
            },
        );
        let req = ValidationRequest {
            schema,
            data: serde_json::json!({ "code": "a!" }),
        };
        let out = validate(&req);
        assert!(!out.valid);
        assert_eq!(
            out.errors.len(),
            1,
            "bail must report a single rule, got {:?}",
            out.errors
        );
        assert_eq!(out.errors[0].rule, "minLength");
    }

    #[test]
    fn bail_defaults_to_true_when_absent_from_the_payload() {
        // An older caller that omits the flag must get upstream behaviour, not the
        // exhaustive mode that silently diverged from it.
        let req: ValidationRequest = serde_json::from_str(
            r#"{"schema":{"code":{"rules":[{"name":"minLength","params":{"min":5}},{"name":"alphaNumeric"}]}},"data":{"code":"a!"}}"#,
        )
        .unwrap();
        let out = validate(&req);
        assert_eq!(out.errors.len(), 1, "{:?}", out.errors);
    }
}
