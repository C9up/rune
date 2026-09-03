/**
 * The parts of the VineJS surface rune ships but never ran: the `tryValidate`
 * tuple, the global accessors behind `vine.errorReporter` and friends, boolean
 * coercion, the conditional-required family, and the date comparisons that
 * read a sibling field.
 *
 * These are all reachable from a consumer's first line of code. A getter that
 * was never read, or a `requiredIfExists` that was never evaluated, is a shape
 * in the type definitions rather than a behaviour.
 */
import { afterEach, describe, expect, it } from "vitest";
import rune, {
	type RuleChain,
	RuneValidationError,
	rules,
	schema,
} from "../../src/index.js";

/** Narrow away null/undefined without a `!` assertion (which lies to the compiler). */
function defined<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("expected a defined value");
	return value;
}

afterEach(() => {
	rune.convertEmptyStringsToNull = false;
	rune.errorReporter = null;
	rune.messagesProvider = null;
});

describe("rune > tryValidate — the tuple form", () => {
	const s = schema({ email: rules.string().email() });

	it("hands back the data in the second slot on success", () => {
		const [error, data] = s.tryValidateSync({ email: "ada@acme.test" });

		expect(error).toBeNull();
		expect(data).toEqual({ email: "ada@acme.test" });
	});

	it("hands back the error in the first slot on failure", () => {
		const [error, data] = s.tryValidateSync({ email: "not an email" });

		expect(data).toBeNull();
		expect(error).toBeInstanceOf(RuneValidationError);
		expect(defined(error?.messages[0]).field).toBe("email");
	});

	it("does the same asynchronously", async () => {
		expect(await s.tryValidate({ email: "ada@acme.test" })).toEqual([
			null,
			{ email: "ada@acme.test" },
		]);
		const [error] = await s.tryValidate({ email: "nope" });
		expect(error).toBeInstanceOf(RuneValidationError);
	});

	it("never throws, which is the whole reason it exists", () => {
		expect(() => s.tryValidateSync(null)).not.toThrow();
		expect(s.tryValidateSync(null)[0]).toBeInstanceOf(RuneValidationError);
	});
});

describe("rune > the global settings read back", () => {
	it("reads back the empty-string conversion flag", () => {
		expect(rune.convertEmptyStringsToNull).toBe(false);
		rune.convertEmptyStringsToNull = true;
		expect(rune.convertEmptyStringsToNull).toBe(true);
	});

	it("turns a posted empty input into an absent one when enabled", () => {
		const s = schema({ nickname: rules.string().minLength(3).optional() });

		// An HTML form posts an untouched input as "", and an optional field
		// should read that as absent rather than as a present, too-short string.
		expect(s.validateResult({ nickname: "" }).valid).toBe(false);
		rune.convertEmptyStringsToNull = true;
		expect(s.validateResult({ nickname: "" }).valid).toBe(true);
	});

	it("reads back the error reporter", () => {
		expect(rune.errorReporter).toBeNull();
		const reporter = () => {};
		rune.errorReporter = reporter;
		expect(rune.errorReporter).toBe(reporter);
	});

	it("reads back the messages provider", () => {
		expect(rune.messagesProvider).toBeNull();
		const provider = { getMessage: () => "custom" };
		rune.messagesProvider = provider;
		expect(rune.messagesProvider).toBe(provider);
	});
});

describe("rune > boolean coercion", () => {
	const s = schema({ accepted: rules.boolean() });
	const strict = schema({ accepted: rules.boolean({ strict: true }) });

	it("reads every spelling a form actually posts", () => {
		for (const [posted, expected] of [
			["true", true],
			["false", false],
			["on", true],
			["off", false],
			["1", true],
			["0", false],
			[1, true],
			[0, false],
			["TRUE", true],
			["  on  ", true],
		] as Array<[unknown, boolean]>) {
			const result = s.validateResult({ accepted: posted });
			expect(result.valid, `for ${JSON.stringify(posted)}`).toBe(true);
			expect(result.data?.accepted).toBe(expected);
		}
	});

	it("leaves a value it does not recognise for the rule to refuse", () => {
		expect(s.validateResult({ accepted: "maybe" }).valid).toBe(false);
		expect(s.validateResult({ accepted: 2 }).valid).toBe(false);
	});

	it("refuses every coerced form under strict", () => {
		// A JSON API that accepts "false" as a boolean has an ambiguity a
		// strict schema exists to remove.
		expect(strict.validateResult({ accepted: "true" }).valid).toBe(false);
		expect(strict.validateResult({ accepted: 1 }).valid).toBe(false);
		expect(strict.validateResult({ accepted: true }).valid).toBe(true);
	});
});

describe("rune > required only under a condition", () => {
	it("requiredIfExists follows the other field", () => {
		const s = schema({
			card: rules.string().optional(),
			cvv: rules.string().requiredIfExists("card"),
		});

		expect(s.validateResult({}).valid).toBe(true);
		expect(s.validateResult({ card: "4242" }).valid).toBe(false);
		expect(s.validateResult({ card: "4242", cvv: "123" }).valid).toBe(true);
		// null is absent, not present.
		expect(s.validateResult({ card: null }).valid).toBe(true);
	});

	it("requiredIfMissing is its mirror", () => {
		const s = schema({
			email: rules.string().optional(),
			phone: rules.string().requiredIfMissing("email"),
		});

		expect(s.validateResult({}).valid).toBe(false);
		expect(s.validateResult({ email: "a@b.co" }).valid).toBe(true);
		expect(s.validateResult({ phone: "+33612345678" }).valid).toBe(true);
	});

	it("requiredWhen compares the other field's value", () => {
		const s = schema({
			country: rules.string(),
			state: rules.string().requiredWhen("country", "=", "US"),
		});

		expect(s.validateResult({ country: "FR" }).valid).toBe(true);
		expect(s.validateResult({ country: "US" }).valid).toBe(false);
		expect(s.validateResult({ country: "US", state: "CA" }).valid).toBe(true);
	});

	it("takes the other comparison operators too", () => {
		const s = schema({
			age: rules.number(),
			guardian: rules.string().requiredWhen("age", "<", 18),
		});

		expect(s.validateResult({ age: 20 }).valid).toBe(true);
		expect(s.validateResult({ age: 12 }).valid).toBe(false);
		expect(s.validateResult({ age: 12, guardian: "Ada" }).valid).toBe(true);
	});

	it("requires the field when any one condition holds", () => {
		const s = schema({
			card: rules.string().optional(),
			country: rules.string().optional(),
			proof: rules
				.string()
				.requiredIfExists("card")
				.requiredWhen("country", "=", "US"),
		});

		expect(s.validateResult({}).valid).toBe(true);
		expect(s.validateResult({ card: "4242" }).valid).toBe(false);
		expect(s.validateResult({ country: "US" }).valid).toBe(false);
	});
});

describe("rune > the date comparisons that were never run", () => {
	const day = (iso: string) => iso;

	it("afterOrEqual accepts the boundary", () => {
		const s = schema({
			at: rules.date().afterOrEqual(day("2026-03-14")),
		});

		expect(s.validateResult({ at: "2026-03-14" }).valid).toBe(true);
		expect(s.validateResult({ at: "2026-03-15" }).valid).toBe(true);
		expect(s.validateResult({ at: "2026-03-13" }).valid).toBe(false);
	});

	it("beforeField reads a sibling", () => {
		const s = schema({
			start: rules.date(),
			end: rules.date(),
			earlier: rules.date().beforeField("end"),
		});

		expect(
			s.validateResult({
				start: "2026-01-01",
				end: "2026-12-31",
				earlier: "2026-06-01",
			}).valid,
		).toBe(true);
		expect(
			s.validateResult({
				start: "2026-01-01",
				end: "2026-06-01",
				earlier: "2026-12-31",
			}).valid,
		).toBe(false);
	});

	it("beforeOrSameAs accepts the same instant", () => {
		const s = schema({
			end: rules.date(),
			start: rules.date().beforeOrSameAs("end"),
		});

		expect(
			s.validateResult({ end: "2026-06-01", start: "2026-06-01" }).valid,
		).toBe(true);
		expect(
			s.validateResult({ end: "2026-06-01", start: "2026-06-02" }).valid,
		).toBe(false);
	});
});

describe("rune > the rules that had no test", () => {
	it("literal accepts exactly one value", () => {
		const s = schema({ kind: rules.any().literal("invoice") });

		expect(s.validateResult({ kind: "invoice" }).valid).toBe(true);
		expect(s.validateResult({ kind: "receipt" }).valid).toBe(false);
	});

	it("regex matches a pattern", () => {
		const s = schema({ slug: rules.string().regex(/^[a-z0-9-]+$/) });

		expect(s.validateResult({ slug: "my-post" }).valid).toBe(true);
		expect(s.validateResult({ slug: "My Post" }).valid).toBe(false);
	});

	it("toLowerCase transforms before the rules run", () => {
		const s = schema({ tag: rules.string().toLowerCase().in(["news"]) });

		expect(s.validateResult({ tag: "NEWS" }).data?.tag).toBe("news");
		expect(s.validateResult({ tag: "NEWS" }).valid).toBe(true);
	});

	it("vat takes a callback resolving the country per payload", () => {
		const s = schema({
			country: rules.string(),
			vat: rules.string().vat((field) => ({
				countryCode: String((field.parent as Record<string, unknown>).country),
			})),
		});

		expect(s.validateResult({ country: "DE", vat: "DE136695976" }).valid).toBe(
			true,
		);
		expect(s.validateResult({ country: "DE", vat: "DE136695975" }).valid).toBe(
			false,
		);
		// The number is a valid German one, but this payload says Italy.
		expect(s.validateResult({ country: "IT", vat: "DE136695976" }).valid).toBe(
			false,
		);
	});
});

describe("rune > the helpers a custom rule is meant to reuse", () => {
	const h = rune.helpers;

	it("reads truthy and falsy the way a form posts them", () => {
		for (const v of [true, 1, "1", "true", "on", "yes", "YES"]) {
			expect(h.isTrue(v), String(v)).toBe(true);
		}
		for (const v of [false, 0, "0", "false", "off", "no", "NO"]) {
			expect(h.isFalse(v), String(v)).toBe(true);
		}
		expect(h.isTrue("maybe")).toBe(false);
		expect(h.isFalse("maybe")).toBe(false);
	});

	it("tells present from absent, counting an empty string as present", () => {
		expect(h.exists("")).toBe(true);
		expect(h.exists(0)).toBe(true);
		expect(h.exists(null)).toBe(false);
		expect(h.isMissing(undefined)).toBe(true);
		expect(h.isMissing("")).toBe(false);
	});

	it("tells a plain object from an array and from null", () => {
		expect(h.isObject({ a: 1 })).toBe(true);
		expect(h.isObject([])).toBe(false);
		expect(h.isObject(null)).toBe(false);
		expect(h.isArray([])).toBe(true);
		expect(h.isArray({})).toBe(false);
	});

	it("checks that every named key is there", () => {
		expect(h.hasKeys({ a: 1, b: 2 }, ["a", "b"])).toBe(true);
		expect(h.hasKeys({ a: 1 }, ["a", "b"])).toBe(false);
		expect(h.hasKeys(null, ["a"])).toBe(false);
	});

	it("reads a dotted path off the payload", () => {
		const field = { data: { user: { address: { city: "Paris" } } } };

		expect(h.getNestedValue("user.address.city", field)).toBe("Paris");
		expect(h.getNestedValue("user.missing.city", field)).toBeUndefined();
		expect(h.getNestedValue("user.address.city.deeper", field)).toBeUndefined();
	});

	it("makes every property of a shape optional without touching the original", () => {
		const props = { name: rules.string(), email: rules.string().email() };
		const optional = h.optional(props);

		expect(schema(optional).validateResult({}).valid).toBe(true);
		// The originals are cloned, so the strict shape still refuses.
		expect(schema(props).validateResult({}).valid).toBe(false);
	});
});

describe("rune > the JSON Schema a validator emits", () => {
	/** One rule per JSON Schema keyword the mapping produces. */
	const emitted = (chain: RuleChain<unknown>) =>
		(
			schema({ field: chain }).toJSONSchema().properties as Record<
				string,
				Record<string, unknown>
			>
		).field;

	it("maps the length and range rules onto their keywords", () => {
		expect(emitted(rules.string().minLength(3))).toMatchObject({
			minLength: 3,
		});
		expect(emitted(rules.string().maxLength(10))).toMatchObject({
			maxLength: 10,
		});
		expect(emitted(rules.string().fixedLength(5))).toMatchObject({
			minLength: 5,
			maxLength: 5,
		});
		expect(emitted(rules.number().min(0))).toMatchObject({ minimum: 0 });
		expect(emitted(rules.number().max(9))).toMatchObject({ maximum: 9 });
		expect(emitted(rules.number().range([1, 5]))).toMatchObject({
			minimum: 1,
			maximum: 5,
		});
	});

	it("maps the string formats", () => {
		expect(emitted(rules.string().email())).toMatchObject({ format: "email" });
		expect(emitted(rules.string().uuid())).toMatchObject({ format: "uuid" });
		expect(emitted(rules.string().url())).toMatchObject({ format: "uri" });
		expect(emitted(rules.string().hexCode())).toMatchObject({
			format: "color",
		});
		expect(emitted(rules.date())).toMatchObject({ format: "date-time" });
	});

	it("maps a pattern, an enum and a literal", () => {
		expect(emitted(rules.string().regex(/^[a-z]+$/))).toMatchObject({
			pattern: "^[a-z]+$",
		});
		expect(emitted(rules.enum(["a", "b"]))).toMatchObject({
			enum: ["a", "b"],
		});
		expect(emitted(rules.any().literal("invoice"))).toMatchObject({
			const: "invoice",
		});
		expect(emitted(rules.string().alpha())).toMatchObject({
			pattern: "^[a-zA-Z]+$",
		});
		expect(emitted(rules.string().alphaNumeric())).toMatchObject({
			pattern: "^[a-zA-Z0-9]+$",
		});
		expect(emitted(rules.string().ulid())).toMatchObject({
			pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
		});
	});

	it("maps the number sign and integer rules", () => {
		expect(emitted(rules.number().positive())).toMatchObject({
			exclusiveMinimum: 0,
		});
		expect(emitted(rules.number().negative())).toMatchObject({
			exclusiveMaximum: 0,
		});
		expect(emitted(rules.number().withoutDecimals())).toMatchObject({
			type: "integer",
		});
	});

	it("maps an IP address to the family it was pinned to", () => {
		expect(emitted(rules.string().ipAddress())).toMatchObject({
			format: "ipv4",
		});
		expect(emitted(rules.string().ipAddress({ version: 6 }))).toMatchObject({
			format: "ipv6",
		});
	});

	it("maps an array's own rules", () => {
		const built = schema({
			tags: rules.array(rules.string()).notEmpty().distinct(),
		}).toJSONSchema();
		const tags = (built.properties as Record<string, Record<string, unknown>>)
			.tags;

		expect(tags).toMatchObject({ minItems: 1, uniqueItems: true });
	});

	it("describes an upload as binary content", () => {
		expect(emitted(rules.file())).toMatchObject({
			type: "string",
			contentEncoding: "binary",
		});
	});
});

describe("rune > a regex rule answers the same thing every time", () => {
	it("does not drift on a global expression", () => {
		// `test()` advances `lastIndex` on /g, so the same value alternates
		// between valid and invalid depending on how many times it was asked.
		const s = schema({ code: rules.string().regex(/[a-z]+/g) });

		for (let i = 0; i < 5; i++) {
			expect(s.validateResult({ code: "abc" }).valid, `call ${i}`).toBe(true);
		}
	});

	it("does not drift on a sticky expression, and stays anchored", () => {
		const s = schema({ code: rules.string().regex(/[a-z]+/y) });

		for (let i = 0; i < 5; i++) {
			expect(s.validateResult({ code: "abc" }).valid, `call ${i}`).toBe(true);
		}
		// `y` anchors at position 0 — stripping the flag would have let this
		// match further along the string.
		expect(s.validateResult({ code: "1abc" }).valid).toBe(false);
	});

	it("keeps two schemas built from one expression independent", () => {
		const pattern = /[a-z]+/g;
		const first = schema({ code: rules.string().regex(pattern) });
		const second = schema({ code: rules.string().regex(pattern) });

		expect(first.validateResult({ code: "abc" }).valid).toBe(true);
		expect(second.validateResult({ code: "abc" }).valid).toBe(true);
		expect(first.validateResult({ code: "abc" }).valid).toBe(true);
	});

	it("honours the flags when validating, even though the emitted schema cannot carry them", () => {
		const s = schema({ code: rules.string().regex(/^abc$/i) });

		expect(s.validateResult({ code: "ABC" }).valid).toBe(true);
		// JSON Schema's `pattern` has nowhere to put `i`, so the export is the
		// bare source — documented on the method.
		const properties = s.toJSONSchema().properties as Record<
			string,
			Record<string, unknown>
		>;
		expect(defined(properties.code).pattern).toBe("^abc$");
	});
});
