/**
 * The ordering operators of `requiredWhen` compare the way JavaScript does,
 * as upstream's bare operator: a numeric string is a number. A form, a
 * multipart body and a query string only ever carry strings.
 */
import { describe, expect, it } from "vitest";
import rune from "../../src/index.js";

type Operator = "<" | ">" | "<=" | ">=";

const dependsOnAge = (operator: Operator, bound: unknown) =>
	rune.create({
		age: rune.number(),
		consent: rune.accepted().requiredWhen("age", operator, bound),
	});

describe("rune > requiredWhen orders a string operand like a number", () => {
	it("a minor cannot skip the consent by sending the age as a string", async () => {
		const signup = dependsOnAge("<", 18);
		for (const age of [17, "17", " 17 ", "9"]) {
			const result = signup.validateResult({ age });
			expect(result.valid).toBe(false);
			expect(result.errors.map((error) => [error.field, error.rule])).toEqual([
				["consent", "required"],
			]);
		}
		await expect(signup.validate({ age: "17" })).rejects.toMatchObject({
			code: "E_VALIDATION_ERROR",
		});
		for (const age of [18, "18", "40"]) {
			expect(signup.validateResult({ age }).valid).toBe(true);
		}
		expect(signup.validateResult({ age: "17", consent: "on" })).toEqual({
			valid: true,
			errors: [],
			data: { age: 17, consent: true },
		});
	});

	it.each<[Operator, unknown, unknown]>([
		["<", "17", "18"],
		[">", "19", "18"],
		["<=", "18", "19"],
		[">=", "18", "17"],
	])("%s fires for %s and not for %s", (operator, firing, quiet) => {
		const schema = dependsOnAge(operator, 18);
		expect(schema.validateResult({ age: firing }).valid).toBe(false);
		expect(schema.validateResult({ age: quiet }).valid).toBe(true);
	});

	it("a sibling with no numeric reading does not fire", () => {
		const schema = rune.create({
			age: rune.any().optional(),
			consent: rune.accepted().requiredWhen("age", "<", 18),
		});
		for (const age of [
			"abc",
			{ years: 17 },
			Object.create(null),
			Symbol("17"),
		]) {
			expect(schema.validateResult({ age }).valid).toBe(true);
		}
		// An absent sibling is `undefined`, below nothing.
		expect(schema.validateResult({}).valid).toBe(true);
	});

	it("two strings compare as strings", () => {
		const schema = rune.create({
			plan: rune.string(),
			card: rune.string().requiredWhen("plan", ">", "free"),
		});
		expect(schema.validateResult({ plan: "premium" }).valid).toBe(false);
		expect(schema.validateResult({ plan: "basic" }).valid).toBe(true);
	});

	it("the equality operators stay strict on the raw sibling", () => {
		const equal = rune.create({
			age: rune.number(),
			consent: rune.accepted().requiredWhen("age", "=", 17),
		});
		expect(equal.validateResult({ age: 17 }).valid).toBe(false);
		expect(equal.validateResult({ age: "17" }).valid).toBe(true);
		const listed = rune.create({
			age: rune.number(),
			consent: rune.accepted().requiredWhen("age", "in", [16, 17]),
		});
		expect(listed.validateResult({ age: 17 }).valid).toBe(false);
		expect(listed.validateResult({ age: "17" }).valid).toBe(true);
	});

	it("reads the sibling of a nested object", () => {
		const schema = rune.create({
			guest: rune.object({
				age: rune.number(),
				consent: rune.accepted().requiredWhen("age", "<", 18),
			}),
		});
		expect(schema.validateResult({ guest: { age: "12" } }).valid).toBe(false);
		expect(schema.validateResult({ guest: { age: "30" } }).valid).toBe(true);
	});
});
