/**
 * The per-locale tables, the two normalisers and the JSON Schema emitter, all
 * transcribed from what VineJS actually calls — validator.js 13.15.35 and
 * normalize-url 9.0.1.
 *
 * Each case here was produced by RUNNING the upstream implementation, not by
 * reading it: the port was checked against 58 290 differential cases, and these
 * pin the ones a future edit would most easily break.
 */
import { describe, expect, it } from "vitest";
import {
	isMobileForLocale,
	isPassport,
	isPostalCode,
	isVat,
	normalizeEmail,
	normalizeUrl,
	SUPPORTED_MOBILE_LOCALES,
	SUPPORTED_PASSPORTS,
	SUPPORTED_POSTAL_CODES,
	SUPPORTED_VAT_COUNTRIES,
} from "../../src/formats.js";
import type { RuleChain } from "../../src/index.js";
import { create, RuneError, rules, schema } from "../../src/index.js";

describe("rune > the tables carry validator.js's coverage", () => {
	it("covers every locale validator.js does, and then some", () => {
		// rune shipped a hand-picked subset — 41 numbering plans out of 169, 48
		// postal codes out of 70. A caller asking for `sw-KE` got a thrown error
		// where VineJS validated the number.
		expect(SUPPORTED_MOBILE_LOCALES.length).toBe(169);
		expect(SUPPORTED_POSTAL_CODES.length).toBe(71);
		expect(SUPPORTED_PASSPORTS.length).toBe(61);
		expect(SUPPORTED_VAT_COUNTRIES.length).toBe(69);
		// The two rune keeps validator.js has no entry for.
		expect(SUPPORTED_POSTAL_CODES).toContain("TR");
		expect(SUPPORTED_PASSPORTS).toContain("NO");
		// Greece answers to its EU VAT prefix AND its ISO code.
		expect(SUPPORTED_VAT_COUNTRIES).toContain("EL");
		expect(SUPPORTED_VAT_COUNTRIES).toContain("GR");
	});

	it("validates a locale rune used to refuse outright", () => {
		expect(isMobileForLocale("+254712345678", "en-KE")).toBe(true);
		expect(isMobileForLocale("+254912345678", "en-KE")).toBe(false);
		expect(isPostalCode("1000", "BD")).toBe(true);
		expect(isPostalCode("9500", "BD")).toBe(false);
		expect(isPassport("AB1234567", "AM")).toBe(true);
		expect(isVat("BR12.345.678/0001-90", "BR")).toBe(true);
	});

	it("still answers null for a locale no table covers", () => {
		// The fail-closed contract is the point: an unchecked value that reports
		// "valid" is the failure mode this package exists to prevent.
		expect(isPostalCode("12345", "ZZ")).toBeNull();
		expect(isMobileForLocale("+41791234567", "xx-XX")).toBeNull();
		expect(isPassport("X1234567", "ZZ")).toBeNull();
		expect(isVat("ZZ123", "ZZ")).toBeNull();
	});

	it("matches the number as written, like validator.js", () => {
		// rune stripped separators before matching, which accepted shapes no
		// register issues — and broke `BY`, whose prefix carries a space.
		expect(isVat("УНП 123456789", "BY")).toBe(true);
		expect(isPostalCode("SW1A 1AA", "GB")).toBe(true);
	});

	it("wraps the Swiss UID check digit instead of refusing it", () => {
		// rune bailed out when the weighted sum left a remainder of 10, but that
		// wraps to a check digit of 1 — so valid UIDs were being refused.
		expect(isVat("CHE100000041", "CH")).toBe(true);
		// A remainder of 1 wants a check digit of 10, which cannot exist.
		expect(isVat("CHE100000160", "CH")).toBe(false);
	});

	it("mobile() with no locale means ANY plan, not just E.164", () => {
		// VineJS defaults the locale to "any": the number matches SOME plan.
		const any = schema({ n: rules.string().mobile() });
		expect(any.validateResult({ n: "07911123456" }).valid).toBe(true);
		expect(any.validateResult({ n: "+33612345678" }).valid).toBe(true);
		expect(any.validateResult({ n: "not a number" }).valid).toBe(false);
		// strictMode still demands the country prefix.
		const strict = schema({ n: rules.string().mobile({ strictMode: true }) });
		expect(strict.validateResult({ n: "07911123456" }).valid).toBe(false);
		expect(strict.validateResult({ n: "+447911123456" }).valid).toBe(true);
	});
});

describe("rune > the normalisers behave as VineJS's do", () => {
	it("normalizeEmail applies the provider rules by default", () => {
		expect(normalizeEmail("A.D.A+news@GMail.com")).toBe("ada@gmail.com");
		expect(normalizeEmail("A.B@googlemail.com")).toBe("ab@gmail.com");
		expect(normalizeEmail("Ada-Lovelace-news@yahoo.com")).toBe(
			"ada-lovelace@yahoo.com",
		);
		expect(normalizeEmail("Ada@ya.ru")).toBe("ada@yandex.ru");
	});

	it("normalizeUrl applies normalize-url's defaults", () => {
		expect(normalizeUrl("www.acme.test/?utm_source=x&b=2&a=1")).toBe(
			"http://acme.test/?a=1&b=2",
		);
	});

	it("normalizeUrl keeps a URL it cannot parse, rather than throwing", () => {
		// normalize-url throws. A transform that throws turns a reportable
		// failure into a crash, so `url()` gets to report it instead.
		expect(normalizeUrl("http://")).toBe("http://");
	});
});

describe("rune > the JSON Schema says what the validator does", () => {
	const node = (chain: RuleChain<unknown>) => {
		const emitted = create({ v: chain }).toJSONSchema();
		const properties = emitted.properties;
		if (typeof properties !== "object" || properties === null) {
			throw new Error("no properties emitted");
		}
		return Object.getOwnPropertyDescriptor(properties, "v")?.value as Record<
			string,
			unknown
		>;
	};

	it("spells a length constraint for the container it applies to", () => {
		// `minLength` on an array node is not a constraint — JSON Schema ignores
		// it — so every array and record length rule was being dropped.
		expect(node(rules.array(rules.string()).minLength(2).maxLength(5))).toEqual(
			expect.objectContaining({ minItems: 2, maxItems: 5 }),
		);
		expect(node(rules.array(rules.string()).fixedLength(3))).toEqual(
			expect.objectContaining({ minItems: 3, maxItems: 3 }),
		);
		expect(
			node(rules.record(rules.string()).minLength(2).maxLength(4)),
		).toEqual(expect.objectContaining({ minProperties: 2, maxProperties: 4 }));
		// A string still gets the string spelling.
		expect(node(rules.string().minLength(2))).toEqual(
			expect.objectContaining({ minLength: 2 }),
		);
	});

	it("describes a non-strict boolean by what it ACCEPTS", () => {
		// `type: "boolean"` described a validator that does not exist: the rule
		// takes "true", "on", 1 and their negatives too.
		expect(node(rules.boolean()).enum).toEqual([
			"1",
			1,
			"true",
			true,
			"on",
			"0",
			0,
			"false",
			false,
			"off",
		]);
		expect(node(rules.boolean()).type).toBeUndefined();
		expect(node(rules.boolean({ strict: true }))).toEqual(
			expect.objectContaining({ type: "boolean" }),
		);
	});

	it("widens the alpha pattern with the options that widen the rule", () => {
		expect(
			node(
				rules.string().alpha({
					allowSpaces: true,
					allowDashes: true,
					allowUnderscores: true,
				}),
			).pattern,
		).toBe("^[a-zA-Z\\s-_]+$");
		expect(
			node(rules.string().alphaNumeric({ allowSpaces: true })).pattern,
		).toBe("^[a-zA-Z0-9\\s]+$");
	});

	it("emits a pattern for hexCode and an enum for in()", () => {
		expect(node(rules.string().hexCode()).pattern).toBe(
			"^#?([0-9a-f]{6}|[0-9a-f]{3}|[0-9a-f]{8})$",
		);
		expect(node(rules.number().in([1, 2])).enum).toEqual([1, 2]);
	});

	it("reads a bare IP version, the way VineJS is called", () => {
		expect(node(rules.string().ipAddress(6)).format).toBe("ipv6");
		expect(node(rules.string().ipAddress({ version: 6 })).format).toBe("ipv6");
		expect(node(rules.string().ipAddress()).format).toBe("ipv4");
	});

	it("says the root object refuses undeclared keys", () => {
		// The nested objects said so; the root did not, so a consumer generating
		// a form from it offered fields the validator silently discards.
		const emitted = create({ a: rules.string() }).toJSONSchema();
		expect(emitted.additionalProperties).toBe(false);
		expect(emitted.required).toEqual(["a"]);
		// And an empty `required` is still emitted, so it reads as "none" and not
		// as "unknown".
		expect(
			create({ a: rules.string().optional() }).toJSONSchema().required,
		).toEqual([]);
	});

	it("keeps a nullable field REQUIRED, because the key must be there", () => {
		// VineJS drops it from `required`, but its own validator refuses `{}` —
		// so the schema it emits contradicts the validator it describes.
		const v = create({ a: rules.string().nullable() });
		expect(v.validateResult({}).valid).toBe(false);
		expect(v.toJSONSchema().required).toEqual(["a"]);
	});
});

describe("rune > partial() refuses what it cannot relax", () => {
	it("throws on a shape with allowUnknownProperties", () => {
		const shape = rules
			.any()
			.object({ a: rules.string() })
			.allowUnknownProperties();
		expect(() => shape.partial()).toThrow(RuneError);
	});

	it("still relaxes an ordinary shape without touching the source", () => {
		const base = rules.any().object({ a: rules.string(), b: rules.number() });
		const relaxed = base.partial(["a"]);
		expect(schema({ u: relaxed }).validateResult({ u: { b: 1 } }).valid).toBe(
			true,
		);
		expect(schema({ u: base }).validateResult({ u: { b: 1 } }).valid).toBe(
			false,
		);
	});
});
