//! ream-validate — validation engine in Rust.
//!
//! Receives a schema description + data (JSON) and returns validation results.
//! Handles type checks, string rules, number rules, email validation.
//!
//! @implements FR40

pub mod engine;

pub use engine::{validate, ValidationRequest, ValidationResult, ValidationError};
