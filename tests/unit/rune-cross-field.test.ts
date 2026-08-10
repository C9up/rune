import { describe, expect, it } from "vitest";
import { createRule, rules, schema } from "../../src/index.js";

/**
 * Cross-field / `.use()` rules (VineJS parity). These schemas always run on the
 * TS engine because a `.use()` rule cannot be serialized to Rust — the point of
 * these tests is precisely the JS FieldContext (root `data`, `parent`, `meta`,
 * `report`) that Rust never sees.
 */

// A reusable "matches another field" rule — the canonical cross-field case.
const sameAs = createRule<string>((value, otherField, field) => {
	if (value !== field.data[otherField]) {
		field.report(`Must match ${otherField}`, "sameAs");
	}
});

describe("rune > cross-field (.use)", () => {
	it("passes when the sibling field matches (reads field.data)", () => {
		const s = schema({
			password: rules.string().min(8),
			passwordConfirmation: rules.string().use(sameAs("password")),
		});
		const r = s.validate({
			password: "hunter2!",
			passwordConfirmation: "hunter2!",
		});
		expect(r.valid).toBe(true);
	});

	it("reports when the sibling field differs", () => {
		const s = schema({
			password: rules.string().min(8),
			passwordConfirmation: rules.string().use(sameAs("password")),
		});
		const r = s.validate({
			password: "hunter2!",
			passwordConfirmation: "nope",
		});
		expect(r.valid).toBe(false);
		expect(r.errors).toContainEqual({
			field: "passwordConfirmation",
			rule: "sameAs",
			message: "Must match password",
		});
	});

	it("createRule with options: the options reach the validator", () => {
		const between = createRule<{ min: number; max: number }>(
			(value, opts, field) => {
				if (
					typeof value === "number" &&
					(value < opts.min || value > opts.max)
				) {
					field.report(
						`Must be between ${opts.min} and ${opts.max}`,
						"between",
					);
				}
			},
		);
		const s = schema({ n: rules.number().use(between({ min: 1, max: 10 })) });
		expect(s.validate({ n: 5 }).valid).toBe(true);
		const bad = s.validate({ n: 50 });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]).toMatchObject({ rule: "between", field: "n" });
	});

	it("createRule without options: callable as rule()", () => {
		const notEmpty = createRule((value, _opts, field) => {
			if (value === "") field.report("Must not be empty", "notEmpty");
		});
		const s = schema({ s: rules.string().use(notEmpty()) });
		expect(s.validate({ s: "x" }).valid).toBe(true);
		expect(s.validate({ s: "" }).valid).toBe(false);
	});

	it("runs on the post-transform value (after trim)", () => {
		const trimmedIsBob = createRule((value, _o, field) => {
			if (value !== "bob") field.report("not bob", "x");
		});
		const s = schema({
			name: rules.string().trim().use(trimmedIsBob()),
		});
		expect(s.validate({ name: "  bob  " }).valid).toBe(true);
	});

	it("field.isValid gates on prior failures", () => {
		const secondary = createRule((_v, _o, field) => {
			if (!field.isValid) return; // skip once the field already failed
			field.report("secondary check", "secondary");
		});
		const s = schema({
			age: rules.number().min(18).use(secondary()),
		});
		// min fails → isValid=false → the use-rule skips itself.
		const bad = s.validate({ age: 5 });
		expect(bad.errors.map((e) => e.rule)).toEqual(["min"]);
		// min passes → isValid=true → the use-rule fires.
		const ok = s.validate({ age: 20 });
		expect(ok.errors.map((e) => e.rule)).toContain("secondary");
	});

	it("field.meta is threaded from validate(data, { meta })", () => {
		let seen: unknown;
		const capture = createRule((_v, _o, field) => {
			seen = field.meta;
		});
		const s = schema({ x: rules.string().use(capture()) });
		s.validate({ x: "a" }, { meta: { tenant: 42 } });
		expect(seen).toEqual({ tenant: 42 });
	});
});

describe("rune > cross-field nested & arrays (parent vs data)", () => {
	it("nested: parent is the immediate object, data is the root, field is the path", () => {
		let parent: unknown;
		let data: unknown;
		let path: string | undefined;
		const capture = createRule((_v, _o, field) => {
			parent = field.parent;
			data = field.data;
			path = field.field;
		});
		const s = schema({
			user: rules.any().object({ name: rules.string().use(capture()) }),
		});
		const input = { user: { name: "bob" } };
		s.validate(input);
		expect(data).toBe(input); // root is the exact input object
		expect(parent).toEqual({ name: "bob" }); // immediate parent (validated copy)
		expect(path).toBe("user.name");
	});

	it("nested cross-field: a rule reads a sibling via field.parent", () => {
		const endAfterStart = createRule((value, _o, field) => {
			const parent = field.parent;
			if (Array.isArray(parent)) return;
			const start = parent.start;
			if (
				typeof value === "number" &&
				typeof start === "number" &&
				value <= start
			) {
				field.report("end must be after start", "endAfterStart");
			}
		});
		const s = schema({
			range: rules.any().object({
				start: rules.number(),
				end: rules.number().use(endAfterStart()),
			}),
		});
		expect(s.validate({ range: { start: 1, end: 5 } }).valid).toBe(true);
		const bad = s.validate({ range: { start: 5, end: 1 } });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]).toMatchObject({
			field: "range.end",
			rule: "endAfterStart",
		});
	});

	it("array items: parent is the array", () => {
		let parent: unknown;
		const capture = createRule((_v, _o, field) => {
			parent = field.parent;
		});
		const s = schema({
			tags: rules.any().array(rules.string().use(capture())),
		});
		s.validate({ tags: ["a", "b"] });
		expect(Array.isArray(parent)).toBe(true);
		expect(parent).toEqual(["a", "b"]);
	});
});

describe("rune > .use coexists with legacy rules", () => {
	it("standard + custom + use rules all run together", () => {
		const s = schema({
			// bail(false): the point here is that all three registers run, which by
			// definition needs the exhaustive mode (VineJS bails per field by default).
			code: rules
				.string()
				.bail(false)
				.min(3)
				.custom("upper", (v) => typeof v === "string" && v === v.toUpperCase())
				.use(sameAs("codeConfirm")),
			codeConfirm: rules.string(),
		});
		expect(s.validate({ code: "ABC", codeConfirm: "ABC" }).valid).toBe(true);
		// custom (not upper) + use (mismatch) both fire.
		const bad = s.validate({ code: "abc", codeConfirm: "xyz" });
		const codeRules = bad.errors
			.filter((e) => e.field === "code")
			.map((e) => e.rule);
		expect(codeRules).toContain("upper");
		expect(codeRules).toContain("sameAs");
	});
});

/**
 * `.message()` targets the rule that was just added, whichever register it
 * landed in. Cross-field and async rules live outside `#rules`, so a naive
 * "last of #rules" lookup silently retargeted the previous value rule.
 */
describe("rune > message() targeting across rule registers", () => {
	it("overrides a cross-field rule's message", () => {
		const s = schema({
			password: rules.string(),
			confirm: rules
				.string()
				.sameAs("password")
				.message("Les mots de passe diffèrent"),
		});
		const res = s.validate({ password: "a", confirm: "b" });
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.rule).toBe("sameAs");
		expect(res.errors[0]?.message).toBe("Les mots de passe diffèrent");
	});

	it("does not steal the message from a preceding value rule", () => {
		const s = schema({
			password: rules.string(),
			confirm: rules
				.string()
				.bail(false)
				.minLength(8)
				.sameAs("password")
				.message("Confirmation invalide"),
		});
		// Too short AND different: minLength keeps its own default message.
		const res = s.validate({ password: "longenough", confirm: "x" });
		const byRule = Object.fromEntries(
			res.errors.map((e) => [e.rule, e.message]),
		);
		expect(byRule.minLength).not.toBe("Confirmation invalide");
		expect(byRule.sameAs).toBe("Confirmation invalide");
	});

	it("overrides an async rule's message", async () => {
		const s = schema({
			email: rules
				.string()
				.unique(async () => false)
				.message("Cet email est déjà pris"),
		});
		const res = await s.validateAsync({ email: "a@b.io" });
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.message).toBe("Cet email est déjà pris");
	});

	it("still throws when no rule precedes it", () => {
		expect(() => rules.string().message("x")).not.toThrow();
		expect(() =>
			new (Object.getPrototypeOf(rules.string()).constructor)().message("x"),
		).toThrow(/must be called after a rule/);
	});
});
