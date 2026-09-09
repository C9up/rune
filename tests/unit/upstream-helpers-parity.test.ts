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
