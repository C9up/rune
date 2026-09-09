/**
 * What an error says when something else has to read it.
 *
 * A validation error crosses process boundaries — a log line, a JSON body, a
 * test report — and each of those reaches for a different accessor. These
 * check the ones that are never called from inside the library, and so had
 * nothing standing between them and a silent break.
 */

import { describe, expect, it } from "vitest";
import { RuneValidationError } from "../../src/errors.js";
import { RuneNativeRequiredError } from "../../src/native.js";

describe("rune > RuneValidationError as something else reads it", () => {
	const error = new RuneValidationError([
		{
			field: "email",
			rule: "email",
			message: "The email field must be a valid email address",
		},
	]);

	it("stringifies with its code, so a log line identifies the failure", () => {
		expect(error.toString()).toBe(
			"RuneValidationError [E_VALIDATION_ERROR]: Validation failure",
		);
	});

	it("names itself to Object.prototype.toString", () => {
		// Without the tag this reads "[object Error]", which loses the one thing
		// worth knowing when the value arrives untyped.
		expect(Object.prototype.toString.call(error)).toBe(
			"[object RuneValidationError]",
		);
	});

	it("keeps the per-field messages addressable", () => {
		expect(error.messages[0]?.field).toBe("email");
		expect(error.messages[0]?.rule).toBe("email");
	});
});

describe("rune > RuneNativeRequiredError", () => {
	it("says what is missing AND what to do about it", () => {
		// This error only ever surfaces on a machine where the binary did not
		// load, which is exactly the machine whose owner cannot read our source
		// to find out why. The remedy has to be in the message.
		const error = new RuneNativeRequiredError();
		expect(error.code).toBe("E_RUNE_NAPI_REQUIRED");
		expect(error.name).toBe("RuneNativeRequiredError");
		expect(error.message).toContain("pnpm build:napi");
		// And a reason, not just a restatement of the failure.
		expect(error.message.length).toBeGreaterThan(
			"[E_RUNE_NAPI_REQUIRED] The Rust validation engine is required but not loaded"
				.length,
		);
	});
});
