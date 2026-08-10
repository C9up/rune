//! Validation engine — validates data against a schema description.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

/// Email regex — compiled once.
static EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").unwrap()
});

/// UUID regex — case-insensitive, matches the TS `UUID_RE` exactly.
static UUID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap()
});

/// ASCII letters only — mirrors the TS `^[a-zA-Z]+$`.
static ALPHA_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z]+$").unwrap());

/// ASCII letters and digits — mirrors the TS `^[a-zA-Z0-9]+$`.
static ALPHANUMERIC_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9]+$").unwrap());

/// Code-point length for a string, element count for an array, else `-1`.
/// Mirrors the TS `sizedLength` helper (`[...v].length` counts code points).
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
    #[serde(default)]
    pub transforms: Vec<String>, // e.g., ["trim"]
    /// Stop at this field's first failing rule (VineJS `FieldOptions.bail`,
    /// which defaults to `true`). Defaults to `true` here too so a payload
    /// omitting the flag behaves like VineJS rather than reporting every rule.
    #[serde(default = "default_bail")]
    pub bail: bool,
}

/// serde default for [`FieldSchema::bail`] — VineJS bails per field by default.
/// Character check backing `alpha` / `alphaNumeric`, honouring the VineJS
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
                errors: vec![ValidationError {
                    field: "_root".to_string(),
                    rule: "type".to_string(),
                    message: "Input must be an object".to_string(),
                }],
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
            errors.push(ValidationError {
                field: field.clone(),
                rule: "required".to_string(),
                message: format!("{} is required", field),
            });
            continue;
        }

        let mut val = value.unwrap().clone();

        // Apply transforms
        for transform in &schema.transforms {
            if transform == "trim" {
                if let Some(s) = val.as_str() {
                    val = serde_json::Value::String(s.trim().to_string());
                }
            }
        }

        // Coerce before validating, mirroring the TS path: VineJS accepts "32"
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
                        if let Ok(n) = text.trim().parse::<f64>() {
                            if let Some(num) = serde_json::Number::from_f64(n) {
                                val = serde_json::Value::Number(num);
                            }
                        }
                    }
                }
                "boolean" => {
                    let coerced = match &val {
                        serde_json::Value::String(text) => {
                            match text.trim().to_ascii_lowercase().as_str() {
                                "true" | "on" | "1" => Some(true),
                                "false" | "off" | "0" => Some(false),
                                _ => None,
                            }
                        }
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
        for rule in &schema.rules {
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
            if let Some(err) = error {
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
        data: if valid { Some(serde_json::Value::Object(validated)) } else { None },
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
        "number" => {
            match value {
                serde_json::Value::Number(n) => {
                    if let Some(f) = n.as_f64() {
                        if f.is_nan() || f.is_infinite() {
                            return Some(err(field, "number", "Must be a number"));
                        }
                    }
                }
                _ => return Some(err(field, "number", "Must be a number")),
            }
        }
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
                // Count Unicode code points, not UTF-8 bytes — otherwise the
                // Rust engine and the TS fallback (which counts UTF-16 code
                // units via [...str].length) disagree on multi-byte strings
                // for the SAME schema. Code-point count makes them agree.
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
                None => return Some(err(field, "minLength", "Invalid minLength rule: missing parameter")),
            };
            if (sized_length(value) as f64) < min {
                return Some(err(field, "minLength", "Too short"));
            }
        }
        "maxLength" => {
            let max = match params.get("max").and_then(|v| v.as_f64()) {
                Some(v) => v,
                None => return Some(err(field, "maxLength", "Invalid maxLength rule: missing parameter")),
            };
            let len = sized_length(value);
            if !(len >= 0 && (len as f64) <= max) {
                return Some(err(field, "maxLength", "Too long"));
            }
        }
        "fixedLength" => {
            let size = match params.get("size").and_then(|v| v.as_f64()) {
                Some(v) => v,
                None => return Some(err(field, "fixedLength", "Invalid fixedLength rule: missing parameter")),
            };
            if (sized_length(value) as f64) != size {
                return Some(err(field, "fixedLength", "Wrong length"));
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
            _ => return Some(err(field, "alphaNumeric", "Must contain only letters and numbers")),
        },
        "startsWith" => {
            let substring = params.get("substring").and_then(|v| v.as_str());
            match (value.as_str(), substring) {
                (Some(s), Some(sub)) if s.starts_with(sub) => {}
                _ => return Some(err(field, "startsWith", "Invalid prefix")),
            }
        }
        "endsWith" => {
            let substring = params.get("substring").and_then(|v| v.as_str());
            match (value.as_str(), substring) {
                (Some(s), Some(sub)) if s.ends_with(sub) => {}
                _ => return Some(err(field, "endsWith", "Invalid suffix")),
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
                _ => return Some(err(field, "range", "Out of range")),
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_request(schema: HashMap<String, FieldSchema>, data: serde_json::Value) -> ValidationRequest {
        ValidationRequest { schema, data }
    }

    #[test]
    fn test_valid_data() {
        let mut schema = HashMap::new();
        schema.insert("name".to_string(), FieldSchema {
            bail: false,
            rules: vec![
                RuleDefinition { name: "string".to_string(), params: serde_json::json!(null) },
                RuleDefinition { name: "min".to_string(), params: serde_json::json!({"min": 3}) },
            ],
            optional: false,
            transforms: vec![],
        });
        schema.insert("email".to_string(), FieldSchema {
            bail: false,
            rules: vec![
                RuleDefinition { name: "string".to_string(), params: serde_json::json!(null) },
                RuleDefinition { name: "email".to_string(), params: serde_json::json!(null) },
            ],
            optional: false,
            transforms: vec![],
        });

        let req = make_request(schema, serde_json::json!({"name": "Kaen", "email": "kaen@c9up.com"}));
        let result = validate(&req);
        assert!(result.valid);
        assert!(result.data.is_some());
    }

    #[test]
    fn test_invalid_data() {
        let mut schema = HashMap::new();
        schema.insert("name".to_string(), FieldSchema {
            bail: false,
            rules: vec![
                RuleDefinition { name: "string".to_string(), params: serde_json::json!(null) },
                RuleDefinition { name: "min".to_string(), params: serde_json::json!({"min": 3}) },
            ],
            optional: false,
            transforms: vec![],
        });

        let req = make_request(schema, serde_json::json!({"name": "Ka"}));
        let result = validate(&req);
        assert!(!result.valid);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].rule, "min");
    }

    #[test]
    fn test_required_field() {
        let mut schema = HashMap::new();
        schema.insert("name".to_string(), FieldSchema {
            bail: false,
            rules: vec![RuleDefinition { name: "string".to_string(), params: serde_json::json!(null) }],
            optional: false,
            transforms: vec![],
        });

        let req = make_request(schema, serde_json::json!({}));
        let result = validate(&req);
        assert!(!result.valid);
        assert_eq!(result.errors[0].rule, "required");
    }

    #[test]
    fn test_optional_field() {
        let mut schema = HashMap::new();
        schema.insert("bio".to_string(), FieldSchema {
            bail: false,
            rules: vec![RuleDefinition { name: "string".to_string(), params: serde_json::json!(null) }],
            optional: true,
            transforms: vec![],
        });

        let req = make_request(schema, serde_json::json!({}));
        let result = validate(&req);
        assert!(result.valid);
    }

    #[test]
    fn test_trim_transform() {
        let mut schema = HashMap::new();
        schema.insert("name".to_string(), FieldSchema {
            bail: false,
            rules: vec![
                RuleDefinition { name: "string".to_string(), params: serde_json::json!(null) },
                RuleDefinition { name: "min".to_string(), params: serde_json::json!({"min": 3}) },
            ],
            optional: false,
            transforms: vec!["trim".to_string()],
        });

        let req = make_request(schema, serde_json::json!({"name": "  Kaen  "}));
        let result = validate(&req);
        assert!(result.valid);
        assert_eq!(result.data.unwrap()["name"], "Kaen");
    }

    #[test]
    fn test_email_rejects_newline() {
        let mut schema = HashMap::new();
        schema.insert("email".to_string(), FieldSchema {
            bail: false,
            rules: vec![RuleDefinition { name: "email".to_string(), params: serde_json::json!(null) }],
            optional: false,
            transforms: vec![],
        });

        let req = make_request(schema, serde_json::json!({"email": "test@test.com\n"}));
        let result = validate(&req);
        assert!(!result.valid);
    }

    #[test]
    fn test_positive_rejects_infinity() {
        let mut schema = HashMap::new();
        schema.insert("amount".to_string(), FieldSchema {
            bail: false,
            rules: vec![
                RuleDefinition { name: "number".to_string(), params: serde_json::json!(null) },
                RuleDefinition { name: "positive".to_string(), params: serde_json::json!(null) },
            ],
            optional: false,
            transforms: vec![],
        });

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
        schema.insert("age".to_string(), FieldSchema {
            bail: false,
            rules: vec![RuleDefinition { name: "number".to_string(), params: serde_json::json!(null) }],
            optional: false,
            transforms: vec![],
        });

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
        schema.insert("q".to_string(), FieldSchema {
            bail: false,
            rules: vec![RuleDefinition { name: "min".to_string(), params: serde_json::json!({"min": 3}) }],
            optional: false,
            transforms: vec![],
        });
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
        schema.insert("s".to_string(), FieldSchema {
            bail: false,
            rules: vec![
                RuleDefinition { name: "string".to_string(), params: serde_json::json!(null) },
                RuleDefinition { name: "max".to_string(), params: serde_json::json!({"max": 1}) },
            ],
            optional: false,
            transforms: vec![],
        });
        let req = make_request(schema, serde_json::json!({"s": "é"}));
        assert!(validate(&req).valid, "one code point must satisfy max=1");
    }

    #[test]
    fn test_boolean_type_check() {
        let mut schema = HashMap::new();
        schema.insert("active".to_string(), FieldSchema {
            bail: false,
            rules: vec![RuleDefinition { name: "boolean".to_string(), params: serde_json::json!(null) }],
            optional: false,
            transforms: vec![],
        });

        let req = make_request(schema, serde_json::json!({"active": "yes"}));
        let result = validate(&req);
        assert!(!result.valid);

        let req2 = make_request(
            { let mut s = HashMap::new(); s.insert("active".to_string(), FieldSchema { bail: false, rules: vec![RuleDefinition { name: "boolean".to_string(), params: serde_json::json!(null) }], optional: false, transforms: vec![] }); s },
            serde_json::json!({"active": true}),
        );
        assert!(validate(&req2).valid);
    }

    #[test]
    fn bail_stops_at_the_first_failing_rule() {
        // VineJS bails per field by default; the engine must agree with the TS
        // path, otherwise the same schema reports differently depending on
        // whether the native binary happened to be loadable.
        let mut schema = HashMap::new();
        schema.insert("code".to_string(), FieldSchema {
            bail: true,
            rules: vec![
                RuleDefinition { name: "string".to_string(), params: serde_json::Value::Null },
                RuleDefinition { name: "minLength".to_string(), params: serde_json::json!({ "min": 5 }) },
                RuleDefinition { name: "alphaNumeric".to_string(), params: serde_json::Value::Null },
            ],
            optional: false,
            transforms: vec![],
        });
        let req = ValidationRequest { schema, data: serde_json::json!({ "code": "a!" }) };
        let out = validate(&req);
        assert!(!out.valid);
        assert_eq!(out.errors.len(), 1, "bail must report a single rule, got {:?}", out.errors);
        assert_eq!(out.errors[0].rule, "minLength");
    }

    #[test]
    fn bail_defaults_to_true_when_absent_from_the_payload() {
        // An older caller that omits the flag must get VineJS behaviour, not the
        // exhaustive mode that silently diverged from it.
        let req: ValidationRequest = serde_json::from_str(
            r#"{"schema":{"code":{"rules":[{"name":"minLength","params":{"min":5}},{"name":"alphaNumeric"}]}},"data":{"code":"a!"}}"#,
        )
        .unwrap();
        let out = validate(&req);
        assert_eq!(out.errors.len(), 1, "{:?}", out.errors);
    }
}
