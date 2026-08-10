/**
 * Format validators backing the VineJS string/number/array rules.
 *
 * VineJS delegates these to `validator.js`. rune has zero runtime dependencies,
 * so each check is implemented here. Where VineJS ships a per-locale table we
 * cannot reasonably reproduce in full (mobile numbers, postal codes, passports),
 * rune supports a named subset and **fails closed** on an unknown locale rather
 * than waving the value through — an unchecked value that reports "valid" is the
 * failure mode this package exists to prevent.
 */

const HEX_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const ULID_RE = /^[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/i;
const JWT_RE = /^[\w-]+\.[\w-]+\.[\w-]*$/;
const IPV4_RE =
	/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const E164_RE = /^\+?[1-9]\d{6,14}$/;

/** Code-point scan rather than a control-character regex, which lints as suspicious. */
export const isAscii = (v: string): boolean =>
	[...v].every((c) => (c.codePointAt(0) ?? 0) <= 0x7f);
export const isHexCode = (v: string): boolean => HEX_RE.test(v);
export const isUlid = (v: string): boolean => ULID_RE.test(v);
export const isJwt = (v: string): boolean => JWT_RE.test(v);

/** IPv6, including the `::` compressed form and IPv4-mapped tails. */
function isIpV6(v: string): boolean {
	if (!v.includes(":")) return false;
	const halves = v.split("::");
	if (halves.length > 2) return false;
	const expand = (part: string): string[] =>
		part === "" ? [] : part.split(":");
	const head = expand(halves[0]);
	const tail = halves.length === 2 ? expand(halves[1]) : [];
	const groups = [...head, ...tail];
	// A trailing IPv4 literal occupies two groups.
	const last = groups.at(-1);
	const ipv4Tail = last?.includes(".") ?? false;
	if (ipv4Tail && last !== undefined && !IPV4_RE.test(last)) return false;
	const count = groups.length + (ipv4Tail ? 1 : 0);
	if (halves.length === 1 ? count !== 8 : count >= 8) return false;
	return groups
		.slice(0, ipv4Tail ? -1 : undefined)
		.every((g) => /^[0-9a-f]{1,4}$/i.test(g));
}

export function isIpAddress(v: string, version?: 4 | 6): boolean {
	if (version === 4) return IPV4_RE.test(v);
	if (version === 6) return isIpV6(v);
	return IPV4_RE.test(v) || isIpV6(v);
}

/** Luhn checksum — the digits-only part of card validation. */
export function isCreditCard(v: string): boolean {
	const digits = v.replace(/[ -]/g, "");
	if (!/^\d{12,19}$/.test(digits)) return false;
	let sum = 0;
	let double = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		let d = digits.charCodeAt(i) - 48;
		if (double) {
			d *= 2;
			if (d > 9) d -= 9;
		}
		sum += d;
		double = !double;
	}
	return sum % 10 === 0;
}

/** IBAN mod-97 check (ISO 13616), computed digit by digit to avoid BigInt. */
export function isIban(v: string): boolean {
	const s = v.replace(/\s/g, "").toUpperCase();
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
	const rearranged = s.slice(4) + s.slice(0, 4);
	let remainder = 0;
	for (const ch of rearranged) {
		const chunk = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55); // A→10 … Z→35
		for (const digit of chunk) {
			remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
		}
	}
	return remainder === 1;
}

/** `"lat,lng"` within the valid ranges. */
export function isCoordinates(v: string): boolean {
	const parts = v.split(",");
	if (parts.length !== 2) return false;
	const lat = Number(parts[0].trim());
	const lng = Number(parts[1].trim());
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Postal-code patterns. A named subset of VineJS's table — extend it here rather
 * than at the call site, and see the module note on unknown locales.
 */
const POSTAL_CODES: Record<string, RegExp> = {
	CH: /^\d{4}$/,
	FR: /^\d{5}$/,
	DE: /^\d{5}$/,
	US: /^\d{5}(?:-\d{4})?$/,
	CA: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
	GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
	IT: /^\d{5}$/,
	ES: /^\d{5}$/,
	BE: /^\d{4}$/,
	NL: /^\d{4} ?[A-Z]{2}$/i,
};

/** Country codes rune can check postal codes for. */
export const SUPPORTED_POSTAL_CODES = Object.keys(POSTAL_CODES);

export function isPostalCode(v: string, countryCode: string): boolean | null {
	const re = POSTAL_CODES[countryCode.toUpperCase()];
	return re === undefined ? null : re.test(v.trim());
}

/**
 * Mobile numbers in E.164 form. Named deviation from VineJS: rune does NOT
 * carry per-locale numbering plans, so `locale` is not accepted — a caller that
 * needs one writes a `.regex()` or a custom rule.
 */
export const isMobile = (v: string): boolean =>
	E164_RE.test(v.replace(/[ .-]/g, ""));
