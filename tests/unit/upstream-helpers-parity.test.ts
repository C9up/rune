/**
 * The `helpers` surface, checked against the upstream package 4.4.0.
 *
 * Every expectation here was read off the upstream package running locally,
 * not recalled: the boolean lists, the `isDistinct` identity semantics and the
 * `getNestedValue` parent lookup all contradicted what rune had before.
 */
import { describe, expect, it } from "vitest";
import rune, { rules, schema } from "../../src/index.js";

const h = rune.helpers;

describe("rune > helpers parity", () => {
	it("carries the whole upstream surface", () => {
		// The 39 upstream names, minus `asDayJS` (replaced by `asDate`, a named
		// deviation so no date library becomes part of rune's contract).
		for (const name of [
			"asBoolean",
			"asNumber",
			"compareValues",
			"exists",
			"getNestedValue",
			"hasKeys",
			"isActiveURL",
			"isAlpha",
			"isAlphaNumeric",
			"isArray",
			"isAscii",
			"isCreditCard",
			"isDecimal",
			"isDistinct",
			"isEmail",
			"isFalse",
			"isHexColor",
			"isIBAN",
			"isIP",
			"isJWT",
			"isLatLong",
			"isMissing",
			"isMobilePhone",
			"isNumeric",
			"isObject",
			"isPassportNumber",
			"isPostalCode",
			"isSlug",
			"isString",
			"isTrue",
			"isULID",
			"isURL",
			"isUUID",
			"isVAT",
			"optional",
		]) {
			expect(typeof Reflect.get(h, name), name).toBe("function");
		}
		for (const name of [
			"mobileLocales",
			"postalCountryCodes",
			"passportCountryCodes",
		]) {
			expect(Array.isArray(Reflect.get(h, name)), name).toBe(true);
		}
		expect(typeof h.asDate).toBe("function");
	});

	it("getNestedValue reads the PARENT for a bare name", () => {
		// Upstream: `key.indexOf(".") > -1 ? delve(field.data, key) : field.parent[key]`.
		// Reading `data` for a bare name returned undefined for every rule
		// running inside an array item or a nested object.
		const field = {
			data: { top: "root", n: { deep: 1 } },
			parent: { local: "sibling" },
		};
		expect(h.getNestedValue("local", field)).toBe("sibling");
		expect(h.getNestedValue("top", field)).toBeUndefined();
		expect(h.getNestedValue("n.deep", field)).toBe(1);
	});

	it("isDistinct compares items by identity when no field is named", () => {
		const shared = { a: 1 };
		expect(h.isDistinct([{ a: 1 }, { a: 1 }])).toBe(true);
		expect(h.isDistinct([shared, shared])).toBe(false);
		expect(h.isDistinct([1, 1])).toBe(false);
		expect(h.isDistinct([null, null])).toBe(true);
	});

	it("isDistinct counts a null-valued key as a value, not as absent", () => {
		// Skipping null values made two rows that both left the field empty pass
		// as distinct; upstream tests key PRESENCE, so they collide.
		expect(h.isDistinct([{ a: null }, { a: null }], "a")).toBe(false);
		expect(h.isDistinct([{ a: 1 }, { b: 2 }], "a")).toBe(true);
		expect(h.isDistinct([{ a: 1 }, { a: 2 }], "a")).toBe(true);
	});

	it("asBoolean / asNumber / compareValues", () => {
		expect(h.asBoolean("on")).toBe(true);
		expect(h.asBoolean("nope")).toBe(null);
		expect(h.asNumber(null)).toBeNaN();
		expect(h.asNumber("12")).toBe(12);
		expect(h.compareValues("1", 1)).toEqual({ isEqual: true, casted: 1 });
		expect(h.compareValues("on", true)).toEqual({
			isEqual: true,
			casted: true,
		});
	});

	it("the format predicates answer as validator.js does", () => {
		expect(
			["hello-world", "Hello", "a--b", "-a"].map((v) => h.isSlug(v)),
		).toEqual([true, false, false, false]);
		expect(["1.5", "1", "", "1."].map((v) => h.isDecimal(v))).toEqual([
			true,
			true,
			false,
			false,
		]);
		expect(h.isUUID("9f1b3c2e-6a4d-4f9b-8c3a-1d2e3f4a5b6c", 4)).toBe(true);
		expect(h.isUUID("00000000-0000-0000-0000-000000000000", "nil")).toBe(true);
		// The `#` is required, as upstream requires it.
		expect([h.isHexColor("#fff"), h.isHexColor("fff")]).toEqual([true, false]);
		expect(h.isULID("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
	});

	it("the country helpers answer null rather than throwing on an unknown code", () => {
		// Named deviation: upstream throws. A predicate that throws turns "no
		// table for this country" into a 500.
		expect(h.isPostalCode("1201", "CH")).toBe(true);
		expect(h.isPostalCode("1201", "ZZ")).toBe(null);
		expect(h.isVAT("CHE-116.281.710 MWST", "CH")).toBe(true);
		expect(h.isPassportNumber("S1234567", "ZZ")).toBe(null);
	});

	it("asDate replaces asDayJS and returns a native Date", () => {
		const parsed = h.asDate("2026-09-09");
		expect(parsed).toBeInstanceOf(Date);
		expect(h.asDate("nonsense")).toBe(null);
	});

	it("the helpers and the chain rules cannot drift apart", () => {
		// Same functions, so a hand-written rule and the chain agree.
		for (const value of ["a@b.io", "nope"]) {
			expect(
				schema({ e: rules.string().email() }).validateResult({ e: value })
					.valid,
			).toBe(h.isEmail(value));
		}
	});
});

describe("rune > helpers: the format predicates", () => {
	// Every expectation below was read off the reference implementation run on
	// the same inputs, not from the regex. Three of them are regressions: the
	// first version of this port accepted an empty `isAscii`, refused
	// `ftp://` and refused a parenthesised coordinate pair.

	it("isString / isNumeric answer about the VALUE, not its shape", () => {
		expect(h.isString("abc")).toBe(true);
		expect(h.isString(42)).toBe(false);
		expect(h.isString(null)).toBe(false);
		// A boxed String is an object, and upstream says false.
		expect(h.isString(new String("x"))).toBe(false);

		expect(h.isNumeric("42")).toBe(true);
		expect(h.isNumeric("4.2")).toBe(true);
		expect(h.isNumeric("-3")).toBe(true);
		expect(h.isNumeric("1e3")).toBe(true);
		// A blank string IS numeric here: the helper is `!Number.isNaN(Number(v))`
		// and `Number("")` is 0. Upstream answers the same, and the `number()`
		// RULE deliberately does not — see the coercion deviation. Do not use
		// this helper to decide whether a form field was filled in.
		expect(h.isNumeric("")).toBe(true);
		expect(h.isNumeric("  ")).toBe(true);
		expect(h.isNumeric("abc")).toBe(false);
	});

	it("isAlpha / isAlphaNumeric / isAscii all refuse an empty string", () => {
		expect(h.isAlpha("abc")).toBe(true);
		expect(h.isAlpha("ab1")).toBe(false);
		expect(h.isAlpha("")).toBe(false);

		expect(h.isAlphaNumeric("abc123")).toBe(true);
		expect(h.isAlphaNumeric("ab-1")).toBe(false);
		expect(h.isAlphaNumeric("")).toBe(false);

		expect(h.isAscii("abc123!")).toBe(true);
		expect(h.isAscii("é")).toBe(false);
		// REGRESSION: a scan over an empty string is vacuously true, so this
		// answered `true` and `ascii()` passed a value with nothing in it.
		expect(h.isAscii("")).toBe(false);
	});

	it("isJWT / isIBAN / isCreditCard check structure, then the check digits", () => {
		expect(h.isJWT("eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig")).toBe(true);
		expect(h.isJWT("a.b")).toBe(false);

		expect(h.isIBAN("CH9300762011623852957")).toBe(true);
		// One digit short: the structure is plausible, the checksum is not.
		expect(h.isIBAN("GB82WEST1234569876543")).toBe(false);

		expect(h.isCreditCard("4111111111111111")).toBe(true);
		expect(h.isCreditCard("1234567890123456")).toBe(false);
	});

	it("isIP accepts both families, and can be pinned to one", () => {
		expect(h.isIP("127.0.0.1")).toBe(true);
		expect(h.isIP("::1")).toBe(true);
		expect(h.isIP("999.1.1.1")).toBe(false);
		expect(h.isIP("::1", 4)).toBe(false);
		expect(h.isIP("127.0.0.1", 4)).toBe(true);
	});

	it("isLatLong accepts the parenthesised pair a map widget hands back", () => {
		expect(h.isLatLong("12.34,56.78")).toBe(true);
		// REGRESSION: refused, while upstream accepts it.
		expect(h.isLatLong("(12.34, 56.78)")).toBe(true);
		expect(h.isLatLong("91,181")).toBe(false);
		expect(h.isLatLong("abc")).toBe(false);
	});

	it("isURL admits ftp by default and can be narrowed", () => {
		expect(h.isURL("https://a.com")).toBe(true);
		// REGRESSION: the helper said true and the `url()` rule said false, so
		// one string got two verdicts depending on which half you asked.
		expect(h.isURL("ftp://a.com")).toBe(true);
		expect(h.isURL("ftp://a.com", { protocols: ["https"] })).toBe(false);
		expect(h.isURL("not a url")).toBe(false);
	});

	it("isMobilePhone answers per locale, and null for one it has no table for", () => {
		expect(h.isMobilePhone("+41791234567", "fr-CH")).toBe(true);
		expect(h.isMobilePhone("abc", "fr-CH")).toBe(false);
		expect(h.isMobilePhone("nope", "zz-ZZ")).toBeNull();
	});
});
