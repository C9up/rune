//! NAPI bindings for ream-validate.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::panic::catch_unwind;

/// Validate data against a schema (JSON string).
#[napi]
pub fn validate(request_json: String) -> Result<String> {
    let result = catch_unwind(|| {
        let request: ream_validate::ValidationRequest = serde_json::from_str(&request_json)
            .map_err(|e| format!("Invalid validation request: {}", e))?;

        let validated = ream_validate::validate(&request);

        serde_json::to_string(&validated)
            .map_err(|e| format!("Serialization error: {}", e))
    });

    match result {
        Ok(Ok(json)) => Ok(json),
        Ok(Err(e)) => Err(Error::from_reason(e)),
        Err(_) => Err(Error::from_reason("Internal panic in validation engine")),
    }
}
