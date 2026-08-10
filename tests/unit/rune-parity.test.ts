import { describe, expect, it } from "vitest";
import {
	type RuleChain,
	RuneValidationError,
	rules,
	SimpleMessagesProvider,
	schema,
} from "../../src/index.js";

/**
 * Failure-path coverage for the VineJS-parity surface added to rune. Every rule
 * is asserted to REJECT invalid input (not just accept valid) — the missing
 * failure-path test is exactly what let bug-3262 (silent bypass) through.
 */

const failingRules = (result: {
	valid: boolean;
	errors: { rule: string }[];
}): string[] => result.errors.map((e) => e.rule);

describe("rune parity > string rules reject invalid input", () => {
	const cases: Array<{
		rule: string;
		chain: () => RuleChain;
		bad: unknown;
		good: unknown;
	}> = [
		{
			rule: "minLength",
			chain: () => rules.string().minLength(5),
			bad: "abc",
			good: "abcde",
		},
		{
			rule: "maxLength",
			chain: () => rules.string().maxLength(3),
			bad: "abcd",
			good: "abc",
		},
		{
			rule: "fixedLength",
			chain: () => rules.string().fixedLength(4),
			bad: "abc",
			good: "abcd",
		},
		{
			rule: "alpha",
			chain: () => rules.string().alpha(),
			bad: "abc1",
			good: "abc",
		},
		{
			rule: "alphaNumeric",
			chain: () => rules.string().alphaNumeric(),
			bad: "abc-1",
			good: "abc1",
		},
		{
			rule: "startsWith",
			chain: () => rules.string().startsWith("ap"),
			bad: "banana",
			good: "apple",
		},
		{
			rule: "endsWith",
			chain: () => rules.string().endsWith("le"),
			bad: "banana",
			good: "apple",
		},
		{
			rule: "uuid",
			chain: () => rules.string().uuid(),
			bad: "not-a-uuid",
			good: "123e4567-e89b-12d3-a456-426614174000",
		},
	];
	for (const c of cases) {
		it(`${c.rule} rejects invalid + accepts valid`, () => {
			const s = schema({ f: c.chain() });
			const bad = s.validateResult({ f: c.bad });
			expect(bad.valid).toBe(false);
			expect(failingRules(bad)).toContain(c.rule);
			expect(s.validateResult({ f: c.good }).valid).toBe(true);
		});
	}
});

describe("rune parity > number rules reject invalid input", () => {
	it("negative rejects >= 0", () => {
		const s = schema({ n: rules.number().negative() });
		expect(s.validateResult({ n: 0 }).valid).toBe(false);
		expect(s.validateResult({ n: 5 }).valid).toBe(false);
		expect(s.validateResult({ n: -1 }).valid).toBe(true);
	});
	it("nonNegative rejects < 0", () => {
		const s = schema({ n: rules.number().nonNegative() });
		expect(s.validateResult({ n: -1 }).valid).toBe(false);
		expect(s.validateResult({ n: 0 }).valid).toBe(true);
	});
	it("range rejects outside [min,max]", () => {
		const s = schema({ n: rules.number().range([1, 10]) });
		expect(s.validateResult({ n: 0 }).valid).toBe(false);
		expect(s.validateResult({ n: 11 }).valid).toBe(false);
		expect(s.validateResult({ n: 5 }).valid).toBe(true);
	});
});

describe("rune parity > in / notIn / enum", () => {
	it("in rejects values outside the set", () => {
		const s = schema({ c: rules.string().in(["red", "green"]) });
		expect(s.validateResult({ c: "blue" }).valid).toBe(false);
		expect(s.validateResult({ c: "red" }).valid).toBe(true);
	});
	it("notIn rejects values inside the set", () => {
		const s = schema({ c: rules.string().notIn(["admin", "root"]) });
		expect(s.validateResult({ c: "admin" }).valid).toBe(false);
		expect(s.validateResult({ c: "guest" }).valid).toBe(true);
	});
	it("enum rejects values outside the enum", () => {
		const s = schema({ role: rules.enum(["user", "admin"] as const) });
		expect(s.validateResult({ role: "superuser" }).valid).toBe(false);
		expect(s.validateResult({ role: "admin" }).valid).toBe(true);
	});
});

describe("rune parity > optional / nullable presence semantics", () => {
	it("optional treats both undefined and null as absent (rune's documented deviation)", () => {
		const s = schema({ x: rules.string().minLength(2).optional() });
		expect(s.validateResult({}).valid).toBe(true);
		expect(s.validateResult({ x: null }).valid).toBe(true);
	});
	it("nullable allows null but NOT undefined (presence required)", () => {
		const s = schema({ x: rules.string().nullable() });
		expect(s.validateResult({ x: null }).valid).toBe(true);
		expect(s.validateResult({}).valid).toBe(false);
	});
	it("nullish allows both", () => {
		const s = schema({ x: rules.string().nullish() });
		expect(s.validateResult({ x: null }).valid).toBe(true);
		expect(s.validateResult({}).valid).toBe(true);
	});
});

describe("rune parity > transform / parse change the output", () => {
	it("parse pre-processes the raw value before validation", () => {
		const s = schema({ n: rules.number().parse((v) => Number(v)) });
		const r = s.validateResult({ n: "42" });
		expect(r.valid).toBe(true);
		if (r.valid) expect(r.data.n).toBe(42);
	});
	it("transform post-processes the validated value", () => {
		const s = schema({
			name: rules.string().transform((v) => String(v).toUpperCase()),
		});
		const r = s.validateResult({ name: "kaen" });
		expect(r.valid).toBe(true);
		if (r.valid) expect(r.data.name).toBe("KAEN");
	});
});

describe("rune parity > validateOrThrow (E_VALIDATION_ERROR)", () => {
	it("throws RuneValidationError with code + status + messages on failure", () => {
		const s = schema({ email: rules.string().email() });
		try {
			s.validateOrThrow({ email: "nope" });
			expect.fail("expected validateOrThrow to throw");
		} catch (err) {
			expect(err).toBeInstanceOf(RuneValidationError);
			if (err instanceof RuneValidationError) {
				expect(err.code).toBe("E_VALIDATION_ERROR");
				expect(err.status).toBe(422);
				expect(err.messages.length).toBeGreaterThan(0);
				expect(err.messages[0].rule).toBe("email");
			}
		}
	});
	it("returns the validated data on success", () => {
		const s = schema({ age: rules.number().positive() });
		expect(s.validateOrThrow({ age: 30 })).toEqual({ age: 30 });
	});
});

describe("rune parity > SimpleMessagesProvider custom messages", () => {
	it("resolves 'field.rule' messages with interpolation", () => {
		const provider = new SimpleMessagesProvider(
			{ "username.minLength": "{{ field }} is too short" },
			{ username: "username" },
		);
		const s = schema({ username: rules.string().minLength(5) });
		const r = s.validateResult(
			{ username: "ab" },
			{ messagesProvider: provider },
		);
		expect(r.valid).toBe(false);
		expect(r.errors[0].message).toContain("too short");
	});
});

/**
 * VineJS validates each field in bail mode by default (`FieldOptions.bail: true`
 * in `@vinejs/vine`), i.e. it stops at that field's first failing rule.
 */
describe("rune > bail defaults to VineJS behaviour", () => {
	it("stops at the first failing rule of a field", () => {
		const s = schema({ code: rules.string().minLength(5).alphaNumeric() });
		const res = s.validateResult({ code: "a!" });
		expect(res.valid).toBe(false);
		// Both rules fail, only the first is reported.
		expect(res.errors.filter((e) => e.field === "code")).toHaveLength(1);
		expect(res.errors[0]?.rule).toBe("minLength");
	});

	it("bail(false) restores exhaustive reporting", () => {
		const s = schema({
			code: rules.string().bail(false).minLength(5).alphaNumeric(),
		});
		const rulesHit = s.validateResult({ code: "a!" }).errors.map((e) => e.rule);
		expect(rulesHit).toEqual(["minLength", "alphaNumeric"]);
	});

	it("does not bail across fields — every field still reports", () => {
		const s = schema({ a: rules.string(), b: rules.string() });
		expect(s.validateResult({ a: 1, b: 2 }).errors).toHaveLength(2);
	});
});
