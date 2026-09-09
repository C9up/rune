/**
 * The predicate surface a custom rule writes against — VineJS `vine.helpers`.
 *
 * A rule built with `createRule` gets a value and has to decide. These are the
 * checks it would otherwise reimplement: the boolean coercions, the format
 * predicates, the country lists. They are the SAME functions the chain rules
 * use, so a hand-written rule and `rules.string().email()` cannot drift apart.
 *
 * ## Named deviations
 *
 * - **`asDate` instead of `asDayJS`.** Upstream returns a Day.js object, which
 *   would make a date library part of rune's public contract and a runtime
 *   dependency for every consumer. rune parses with its own date module and
 *   hands back a native `Date` (or `null`). Same job, no dependency, and the
 *   return type is one every caller already has.
 * - **An unknown country code returns `null`, not a throw.** `isPostalCode`,
 *   `isPassportNumber` and `isVAT` answer `null` when they have no table for
 *   the country, where upstream throws. A validation predicate that throws
 *   turns "I don't know" into a 500; `null` lets the caller decide, and the
 *   chain rules already fail closed on it.
 */

import { type DateFormat, parseDateValue } from "./date.js";
import {
	type AlphaOptions,
	alphaPattern,
	isAscii as isAsciiFormat,
	isCoordinates,
	isCreditCard as isCreditCardFormat,
	isEmail as isEmailFormat,
	isHexCode,
	isIban,
	isIpAddress,
	isJwt,
	isMobileForLocale,
	isPassport,
	isPostalCode as isPostalCodeFormat,
	isUlid,
	isUrlWithOptions,
	isVat,
	SUPPORTED_MOBILE_LOCALES,
	SUPPORTED_PASSPORTS,
	SUPPORTED_POSTAL_CODES,
	type UrlOptions,
} from "./formats.js";

/**
 * The exact values upstream accepts as `true`. Case-sensitive and short on
 * purpose: `"yes"` and `"TRUE"` are NOT in it, so a payload carrying them is
 * refused rather than guessed at.
 */
const BOOLEAN_POSITIVES: readonly unknown[] = ["on", "1", 1, "true", true];

/** The exact values upstream accepts as `false`. `"off"` and `"no"` are NOT. */
const BOOLEAN_NEGATIVES: readonly unknown[] = ["0", 0, "false", false];

/** validator.js `isSlug`, transcribed from 13.15.35. */
const SLUG_RE = /^[a-z0-9](?!.*[-_]{2,})(?:[a-z0-9_-]*[a-z0-9])?$/;

/** validator.js `isUUID`, one pattern per version plus the special names. */
const UUID_PATTERNS: Record<string, RegExp> = {
	1: /^[0-9A-F]{8}-[0-9A-F]{4}-1[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
	2: /^[0-9A-F]{8}-[0-9A-F]{4}-2[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
	3: /^[0-9A-F]{8}-[0-9A-F]{4}-3[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
	4: /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
	5: /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
	6: /^[0-9A-F]{8}-[0-9A-F]{4}-6[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
	7: /^[0-9A-F]{8}-[0-9A-F]{4}-7[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
	8: /^[0-9A-F]{8}-[0-9A-F]{4}-8[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
	nil: /^00000000-0000-0000-0000-000000000000$/i,
	max: /^ffffffff-ffff-ffff-ffff-ffffffffffff$/i,
	loose: /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i,
	all: /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i,
};

/** The decimal separator per locale, for {@link isDecimal}. */
const DECIMAL_SEPARATORS: Record<string, string> = { "en-US": ".", ar: "٫" };

/** Options accepted by {@link isDecimal} — the validator.js spellings. */
export interface DecimalOptions {
	/** Require the decimal part. Defaults to `false`. */
	force_decimal?: boolean;
	/** How many decimal digits, as a regex quantifier body. Defaults to `"1,"`. */
	decimal_digits?: string;
	/** Which separator to expect. Defaults to `"en-US"` (a dot). */
	locale?: string;
}

/** The minimum a helper needs of a field to read a sibling off it. */
export interface NestedValueField {
	/** The whole payload, for a dotted path. */
	data: Record<string, unknown>;
	/** The immediate parent, for a bare name. Absent means a bare name reads nothing. */
	parent?: unknown;
}

/** Walk a dotted path, giving up at the first non-object. */
function delve(source: unknown, path: string): unknown {
	let cursor = source;
	for (const segment of path.split(".")) {
		if (typeof cursor !== "object" || cursor === null) return undefined;
		cursor = Reflect.get(cursor, segment);
	}
	return cursor;
}

/** Neither `undefined` nor `null`. An empty string IS present. */
export function exists(value: unknown): boolean {
	return value !== undefined && value !== null;
}

/** `undefined` or `null`. */
export function isMissing(value: unknown): boolean {
	return value === undefined || value === null;
}

/** An array. */
export const isArray: (value: unknown) => value is unknown[] = Array.isArray;

/** A plain object — not an array, not `null`. */
export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every listed key is present on the object. */
export function hasKeys(value: unknown, keys: readonly string[]): boolean {
	return isObject(value) && keys.every((key) => key in value);
}

/** A string, and nothing else — `new String()` included is still an object. */
export function isString(value: unknown): value is string {
	return typeof value === "string";
}

/** Coerces to a number that is not `NaN`. Note `""` and `" "` coerce to 0. */
export function isNumeric(value: unknown): boolean {
	return !Number.isNaN(Number(value));
}

/** `true` / `false` for a recognised spelling, `null` for anything else. */
export function asBoolean(value: unknown): boolean | null {
	if (isTrue(value)) return true;
	if (isFalse(value)) return false;
	return null;
}

/** `Number(value)`, with `null` mapped to `NaN` rather than 0. */
export function asNumber(value: unknown): number {
	return value === null ? Number.NaN : Number(value);
}

/**
 * Parse a date the way rune's `date()` rule does, returning a native `Date`.
 *
 * This is rune's answer to upstream's `asDayJS`; see the deviation note at the
 * top of this module.
 */
export function asDate(value: unknown, formats?: DateFormat[]): Date | null {
	// Same default as the `date()` rule, so the helper and the chain agree.
	return parseDateValue(value, formats ?? ["iso8601"]);
}

/** One of the values upstream reads as `true`. */
export function isTrue(value: unknown): boolean {
	return BOOLEAN_POSITIVES.includes(value);
}

/** One of the values upstream reads as `false`. */
export function isFalse(value: unknown): boolean {
	return BOOLEAN_NEGATIVES.includes(value);
}

/**
 * Compare an input against an expected value, coercing the input to the
 * expected value's TYPE first — so `"1"` equals `1` and `"on"` equals `true`.
 * Returns the verdict alongside what the input became.
 */
export function compareValues(
	inputValue: unknown,
	expectedValue: unknown,
): { isEqual: boolean; casted: unknown } {
	let input: unknown = inputValue;
	if (typeof expectedValue === "boolean") input = asBoolean(inputValue);
	else if (typeof expectedValue === "number") input = asNumber(inputValue);
	return { isEqual: input === expectedValue, casted: input };
}

/**
 * Read a value off the field being validated. A DOTTED key walks the whole
 * payload from the root; a bare name reads the immediate PARENT, so a rule
 * inside an array item or a nested object sees its own siblings.
 */
export function getNestedValue(key: string, field: NestedValueField): unknown {
	if (key.indexOf(".") > -1) return delve(field.data, key);
	if (typeof field.parent !== "object" || field.parent === null) {
		return undefined;
	}
	return Reflect.get(field.parent, key);
}

/**
 * No duplicate in the data set.
 *
 * With no `fields`, items are compared by IDENTITY — two structurally equal
 * objects are two different items. With `fields`, only items that are objects
 * carrying EVERY named key take part; the rest are skipped, so an item that
 * simply lacks the key is never a duplicate of another that lacks it.
 */
export function isDistinct(
	dataSet: readonly unknown[],
	fields?: string | readonly string[],
): boolean {
	const seen = new Set<unknown>();
	if (fields === undefined) {
		for (const item of dataSet) {
			if (!exists(item)) continue;
			if (seen.has(item)) return false;
			seen.add(item);
		}
		return true;
	}
	const fieldsList = Array.isArray(fields) ? fields : [fields];
	for (const item of dataSet) {
		if (!isObject(item) || !hasKeys(item, fieldsList)) continue;
		const element = fieldsList.map((field) => item[field]).join("_");
		if (seen.has(element)) return false;
		seen.add(element);
	}
	return true;
}

/** Only ASCII letters, plus whatever the options allow. */
export function isAlpha(value: string, options?: AlphaOptions): boolean {
	return value.length > 0 && alphaPattern("a-zA-Z", options).test(value);
}

/** Only ASCII letters and digits, plus whatever the options allow. */
export function isAlphaNumeric(value: string, options?: AlphaOptions): boolean {
	return value.length > 0 && alphaPattern("a-zA-Z0-9", options).test(value);
}

/** Only characters in the ASCII range. */
export function isAscii(value: string): boolean {
	return isAsciiFormat(value);
}

/** A lowercase slug: no leading separator, no doubled `-`/`_`, no trailing one. */
export function isSlug(value: string): boolean {
	return SLUG_RE.test(value);
}

/** A decimal number written as a string, per the validator.js rules. */
export function isDecimal(
	value: string,
	options: DecimalOptions = {},
): boolean {
	if (["", "-", "+"].includes(value)) return false;
	const separator = DECIMAL_SEPARATORS[options.locale ?? "en-US"] ?? ".";
	const digits = options.decimal_digits ?? "1,";
	const pattern = new RegExp(
		`^[-+]?([0-9]+)?(\\${separator}[0-9]{${digits}})${
			options.force_decimal ? "" : "?"
		}$`,
	);
	return pattern.test(value);
}

/** A UUID. Pass a version (1-8), or `"nil"` / `"max"` / `"loose"` / `"all"`. */
export function isUUID(value: string, version?: number | string): boolean {
	const pattern = UUID_PATTERNS[String(version ?? "all")];
	if (!pattern) return false;
	return pattern.test(value);
}

/** A `#`-prefixed hex colour. The `#` is required, as upstream requires it. */
export function isHexColor(value: string): boolean {
	if (!value.startsWith("#")) return false;
	return isHexCode(value);
}

/** A ULID. */
export function isULID(value: unknown): boolean {
	if (typeof value !== "string" || value.length === 0) return false;
	// Upstream's cheap pre-check: a first character above "7" cannot be a
	// timestamp that fits in 48 bits.
	if (value.charAt(0) > "7") return false;
	return isUlid(value);
}

/** A JSON Web Token — three base64url segments. */
export function isJWT(value: string): boolean {
	return isJwt(value);
}

/** An IBAN, checksum included. */
export function isIBAN(value: string): boolean {
	return isIban(value);
}

/** A credit-card number, Luhn included. */
export function isCreditCard(value: string): boolean {
	return isCreditCardFormat(value);
}

/** An IP address. Pass `4` or `6` to demand one family. */
export function isIP(value: string, version?: 4 | 6): boolean {
	return isIpAddress(value, version);
}

/** A `"lat,long"` pair. */
export function isLatLong(value: string): boolean {
	return isCoordinates(value);
}

/** An email address. */
export function isEmail(
	value: string,
	options?: Parameters<typeof isEmailFormat>[1],
): boolean {
	return isEmailFormat(value, options);
}

/** A URL. */
export function isURL(value: string, options?: UrlOptions): boolean {
	return isUrlWithOptions(value, options);
}

/**
 * A phone number for one locale, or for ANY known locale when none is given.
 * `null` when the locale has no table — see the deviation note above.
 */
export function isMobilePhone(value: string, locale?: string): boolean | null {
	if (locale === undefined) {
		return SUPPORTED_MOBILE_LOCALES.some(
			(known) => isMobileForLocale(value, known) === true,
		);
	}
	return isMobileForLocale(value, locale);
}

/** A postal code for a country. `null` when the country has no table. */
export function isPostalCode(
	value: string,
	countryCode: string,
): boolean | null {
	return isPostalCodeFormat(value, countryCode);
}

/** A passport number for a country. `null` when the country has no table. */
export function isPassportNumber(
	value: string,
	countryCode: string,
): boolean | null {
	return isPassport(value, countryCode);
}

/** A VAT number for a country. `null` when the country has no table. */
export function isVAT(value: string, countryCode: string): boolean | null {
	return isVat(value, countryCode);
}

/**
 * Does this URL resolve in DNS? Async, and it hits the network — upstream
 * does the same, and there is no way to answer it offline.
 */
export async function isActiveURL(url: string): Promise<boolean> {
	const { resolve4, resolve6 } = await import("node:dns/promises");
	try {
		const { hostname } = new URL(url);
		if ((await resolve6(hostname)).length) return true;
		return (await resolve4(hostname)).length > 0;
	} catch {
		return false;
	}
}

/** Every locale {@link isMobilePhone} knows. */
export const mobileLocales: readonly string[] = SUPPORTED_MOBILE_LOCALES;

/** Every country {@link isPostalCode} knows. */
export const postalCountryCodes: readonly string[] = SUPPORTED_POSTAL_CODES;

/** Every country {@link isPassportNumber} knows. */
export const passportCountryCodes: readonly string[] = SUPPORTED_PASSPORTS;

/** Every country {@link isVAT} knows. */
export { SUPPORTED_VAT_COUNTRIES as vatCountryCodes } from "./formats.js";
