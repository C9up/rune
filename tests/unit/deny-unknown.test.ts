/**
 * Refusing a key the shape does not declare.
 *
 * Dropping is the default, and stays it — that is what upstream does and what
 * makes a validated payload safe to hand to a mass assignment. This is the
 * opt-in for an API whose contract is that it refuses what it does not
 * understand.
 */
import { describe, expect, it } from "vitest";
import { rules, schema } from "../../src/index.js";

const shape = () =>
	rules.object({
		email: rules.string().email(),
		password: rules.string().min(8),
	});

describe("rune > unknown keys", () => {
	it("drops them by default, and says the payload is valid", () => {
		const result = schema({ user: shape() }).validateResult({
			user: { email: "a@b.co", password: "longenough", extra: 1 },
		});

		expect(result.valid).toBe(true);
		expect(result.data?.user).toEqual({
			email: "a@b.co",
			password: "longenough",
		});
	});

	it("keeps them when asked to", () => {
		const result = schema({
			user: shape().allowUnknownProperties(),
		}).validateResult({
			user: { email: "a@b.co", password: "longenough", extra: 1 },
		});

		expect(result.valid).toBe(true);
		expect(result.data?.user).toMatchObject({ extra: 1 });
	});

	it("fails on them when asked to, naming the key and the shape", () => {
		const result = schema({
			user: shape().denyUnknownProperties(),
		}).validateResult({
			user: { email: "a@b.co", password: "longenough", extra: 1 },
		});

		expect(result.valid).toBe(false);
		// A typo is the common case, so the alternatives are part of the answer.
		expect(result.errors?.[0]?.message).toBe(
			"unknown field `extra`, expected one of email, password",
		);
		expect(result.errors?.[0]?.field).toBe("user.extra");
	});

	it("names every undeclared key, not just the first", () => {
		const result = schema({
			user: shape().denyUnknownProperties(),
		}).validateResult({
			user: { email: "a@b.co", password: "longenough", a: 1, b: 2 },
		});

		expect(result.errors?.map((e) => e.field)).toEqual(["user.a", "user.b"]);
	});

	it("still reports what is wrong with the declared keys", () => {
		const result = schema({
			user: shape().denyUnknownProperties(),
		}).validateResult({ user: { email: "not-an-email", extra: 1 } });

		const rules = result.errors?.map((e) => e.rule) ?? [];
		expect(rules).toContain("unknownField");
		expect(rules.some((rule) => rule !== "unknownField")).toBe(true);
	});

	it("accepts a payload that declares nothing extra", () => {
		const result = schema({
			user: shape().denyUnknownProperties(),
		}).validateResult({ user: { email: "a@b.co", password: "longenough" } });

		expect(result.valid).toBe(true);
	});

	it("lets the last call win, so a chain cannot mean both", () => {
		expect(
			shape().denyUnknownProperties().allowUnknownProperties().allowsUnknown,
		).toBe(true);
		expect(
			shape().allowUnknownProperties().denyUnknownProperties().deniesUnknown,
		).toBe(true);
	});
});
