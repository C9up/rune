/**
 * What an error says when something else has to read it.
 *
 * A validation error crosses process boundaries — a log line, a JSON body, a
 * test report — and each of those reaches for a different accessor. These
 * check the ones that are never called from inside the library, and so had
 * nothing standing between them and a silent break.
 */

import { describe, expect, it } from "vitest";
import {
	errors,
	rules,
	SimpleErrorReporter,
	schema,
	ValidationError,
} from "../../src/index.js";

describe("rune > errors.E_VALIDATION_ERROR as something else reads it", () => {
	const error = new errors.E_VALIDATION_ERROR([
		{
			field: "email",
			rule: "email",
			message: "The email field must be a valid email address",
		},
	]);

	it("stringifies with its code, so a log line identifies the failure", () => {
		expect(error.toString()).toBe(
			"E_VALIDATION_ERROR [E_VALIDATION_ERROR]: Validation failure",
		);
	});

	it("names itself to Object.prototype.toString", () => {
		// Without the tag this reads "[object Error]", which loses the one thing
		// worth knowing when the value arrives untyped.
		expect(Object.prototype.toString.call(error)).toBe(
			"[object E_VALIDATION_ERROR]",
		);
	});

	it("keeps the per-field messages addressable", () => {
		expect(error.messages[0]?.field).toBe("email");
		expect(error.messages[0]?.rule).toBe("email");
	});
});

describe("rune > errors.E_RUNE_NAPI_REQUIRED", () => {
	it("says what is missing AND what to do about it", () => {
		// This error only ever surfaces on a machine where the binary did not
		// load, which is exactly the machine whose owner cannot read our source
		// to find out why. The remedy has to be in the message.
		const error = new errors.E_RUNE_NAPI_REQUIRED([
			"install @c9up/rune-linux-x64-gnu at the exact version of @c9up/rune",
		]);
		expect(error.code).toBe("E_RUNE_NAPI_REQUIRED");
		expect(error.message).toBe(
			"The Rust validation engine is required but not loaded.\n" +
				"  Fix: install @c9up/rune-linux-x64-gnu at the exact version of @c9up/rune",
		);
	});
});

describe("rune > ValidationError, the class upstream exports", () => {
	it("is errors.E_VALIDATION_ERROR under its class name", () => {
		expect(ValidationError).toBe(errors.E_VALIDATION_ERROR);
		const error = new ValidationError([]);
		expect(error).toBeInstanceOf(errors.E_VALIDATION_ERROR);
		expect(error.status).toBe(422);
		expect(error.code).toBe("E_VALIDATION_ERROR");
		expect(error.message).toBe("Validation failure");
	});
});

describe("rune > SimpleErrorReporter", () => {
	const s = schema({
		email: rules.string().email(),
		tags: rules.array(rules.string().minLength(3)),
	});

	it("collects each failure as a node and builds the validation error", async () => {
		const reporters: SimpleErrorReporter[] = [];
		const failure = await s
			.validate(
				{ email: "nope", tags: ["ok!", "x"] },
				{
					errorReporter: () => {
						const reporter = new SimpleErrorReporter();
						reporters.push(reporter);
						return reporter;
					},
				},
			)
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(ValidationError);
		const reporter = reporters[0];
		expect(reporter?.hasErrors).toBe(true);
		expect(reporter?.errors).toEqual([
			expect.objectContaining({ field: "email", rule: "email" }),
			expect.objectContaining({ field: "tags.1", rule: "minLength", index: 1 }),
		]);
		if (failure instanceof ValidationError)
			expect(failure.messages).toBe(reporter?.errors);
	});

	it("takes a dotted path where no field context is at hand", () => {
		const reporter = new SimpleErrorReporter();
		expect(reporter.hasErrors).toBe(false);
		reporter.report("Required", "required", "user.email", { min: 1 });
		expect(reporter.errors).toEqual([
			{
				message: "Required",
				rule: "required",
				field: "user.email",
				meta: { min: 1 },
			},
		]);
		expect(reporter.createError().messages).toBe(reporter.errors);
	});
});
