//! NAPI bindings for ream-validate.

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Validate data against a schema (JSON string).
/// Returns JSON: { valid: boolean, errors: [...], data?: {...} }
#[napi]
pub fn validate(request_json: String) -> Result<String> {
    let request: ream_validate::ValidationRequest = serde_json::from_str(&request_json)
        .map_err(|e| Error::from_reason(format!("Invalid validation request: {}", e)))?;

    let result = ream_validate::validate(&request);

    serde_json::to_string(&result)
        .map_err(|e| Error::from_reason(format!("Serialization error: {}", e)))
}
