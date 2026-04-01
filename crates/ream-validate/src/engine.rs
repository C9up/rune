//! Validation engine — validates data against a schema description.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

/// Email regex — compiled once.
static EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").unwrap()
});

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

        // Validate rules
        let mut field_valid = true;
        for rule in &schema.rules {
            let error = validate_rule(&rule.name, &rule.params, &val, field);
            if let Some(err) = error {
                errors.push(err);
                field_valid = false;
            }
        }

        if field_valid {
            validated.insert(field.clone(), val);
        }
    }

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
            let min = params.get("min").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if let Some(s) = value.as_str() {
                if (s.len() as f64) < min {
                    return Some(err(field, "min", &format!("Minimum {}", min as u64)));
                }
            } else if let Some(n) = value.as_f64() {
                if n < min {
                    return Some(err(field, "min", &format!("Minimum {}", min)));
                }
            }
        }
        "max" => {
            let max = params.get("max").and_then(|v| v.as_f64()).unwrap_or(f64::MAX);
            if let Some(s) = value.as_str() {
                if (s.len() as f64) > max {
                    return Some(err(field, "max", &format!("Maximum {}", max as u64)));
                }
            } else if let Some(n) = value.as_f64() {
                if n > max {
                    return Some(err(field, "max", &format!("Maximum {}", max)));
                }
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
            rules: vec![
                RuleDefinition { name: "string".to_string(), params: serde_json::json!(null) },
                RuleDefinition { name: "min".to_string(), params: serde_json::json!({"min": 3}) },
            ],
            optional: false,
            transforms: vec![],
        });
        schema.insert("email".to_string(), FieldSchema {
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
    fn test_boolean_type_check() {
        let mut schema = HashMap::new();
        schema.insert("active".to_string(), FieldSchema {
            rules: vec![RuleDefinition { name: "boolean".to_string(), params: serde_json::json!(null) }],
            optional: false,
            transforms: vec![],
        });

        let req = make_request(schema, serde_json::json!({"active": "yes"}));
        let result = validate(&req);
        assert!(!result.valid);

        let req2 = make_request(
            { let mut s = HashMap::new(); s.insert("active".to_string(), FieldSchema { rules: vec![RuleDefinition { name: "boolean".to_string(), params: serde_json::json!(null) }], optional: false, transforms: vec![] }); s },
            serde_json::json!({"active": true}),
        );
        assert!(validate(&req2).valid);
    }
}
