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
	AD: /^AD\d{3}$/i,
	AT: /^\d{4}$/,
	AU: /^\d{4}$/,
	BE: /^\d{4}$/,
	BG: /^\d{4}$/,
	BR: /^\d{5}-?\d{3}$/,
	CA: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
	CH: /^\d{4}$/,
	CN: /^\d{6}$/,
	CZ: /^\d{3} ?\d{2}$/,
	DE: /^\d{5}$/,
	DK: /^\d{4}$/,
	EE: /^\d{5}$/,
	ES: /^\d{5}$/,
	FI: /^\d{5}$/,
	FR: /^\d{5}$/,
	GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
	GR: /^\d{3} ?\d{2}$/,
	HR: /^\d{5}$/,
	HU: /^\d{4}$/,
	IE: /^[A-Z]\d[\dW] ?[A-Z\d]{4}$/i,
	IL: /^\d{5}(?:\d{2})?$/,
	IN: /^\d{6}$/,
	IS: /^\d{3}$/,
	IT: /^\d{5}$/,
	JP: /^\d{3}-?\d{4}$/,
	KR: /^\d{5}$/,
	LI: /^\d{4}$/,
	LT: /^(?:LT-)?\d{5}$/i,
	LU: /^\d{4}$/,
	LV: /^(?:LV-)?\d{4}$/i,
	MC: /^980\d{2}$/,
	MT: /^[A-Z]{3} ?\d{4}$/i,
	MX: /^\d{5}$/,
	NL: /^\d{4} ?[A-Z]{2}$/i,
	NO: /^\d{4}$/,
	NZ: /^\d{4}$/,
	PL: /^\d{2}-?\d{3}$/,
	PT: /^\d{4}-?\d{3}$/,
	RO: /^\d{6}$/,
	RU: /^\d{6}$/,
	SE: /^\d{3} ?\d{2}$/,
	SI: /^(?:SI-)?\d{4}$/i,
	SK: /^\d{3} ?\d{2}$/,
	TR: /^\d{5}$/,
	UA: /^\d{5}$/,
	US: /^\d{5}(?:-\d{4})?$/,
	ZA: /^\d{4}$/,
};

/** Country codes rune can check postal codes for. */
export const SUPPORTED_POSTAL_CODES = Object.keys(POSTAL_CODES);

export function isPostalCode(v: string, countryCode: string): boolean | null {
	const re = POSTAL_CODES[countryCode.toUpperCase()];
	return re === undefined ? null : re.test(v.trim());
}

/**
 * Mobile numbers in E.164 form — the locale-less check. Per-locale plans live
 * in `MOBILE_LOCALES`; see {@link isMobileForLocale}.
 */
export const isMobile = (v: string): boolean =>
	E164_RE.test(v.replace(/[ .-]/g, ""));

/** HTML-escape the five characters that break out of markup (VineJS `escape`). */
export function escapeHtml(v: string): string {
	return v
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;");
}

/** Options accepted by `normalizeEmail` (subset of VineJS's). */
export interface NormalizeEmailOptions {
	/** validator.js spelling — takes precedence over the camelCase alias. */
	all_lowercase?: boolean;
	/** validator.js spelling. */
	gmail_remove_dots?: boolean;
	/** validator.js spelling. */
	gmail_remove_subaddress?: boolean;
	/** Lowercase the whole address. Defaults to `true`, like VineJS. */
	allLowercase?: boolean;
	/** Strip dots from a Gmail local part (`a.b@gmail.com` → `ab@gmail.com`). */
	gmailRemoveDots?: boolean;
	/** Drop a `+tag` suffix from the local part. */
	gmailRemoveSubaddress?: boolean;
}

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function normalizeEmail(
	value: string,
	options: NormalizeEmailOptions = {},
): string {
	const at = value.lastIndexOf("@");
	if (at < 1) return value;
	let local = value.slice(0, at);
	let domain = value.slice(at + 1);
	// The domain is case-insensitive per RFC 1035, so it is always lowercased.
	domain = domain.toLowerCase();
	const allLowercase = options.all_lowercase ?? options.allLowercase;
	const removeSubaddress =
		options.gmail_remove_subaddress ?? options.gmailRemoveSubaddress;
	const removeDots = options.gmail_remove_dots ?? options.gmailRemoveDots;
	if (allLowercase !== false) local = local.toLowerCase();
	if (GMAIL_DOMAINS.has(domain)) {
		if (removeSubaddress) local = local.split("+")[0];
		if (removeDots) local = local.replace(/\./g, "");
	} else if (removeSubaddress) {
		local = local.split("+")[0];
	}
	return `${local}@${domain}`;
}

/** Options accepted by `normalizeUrl` (subset of VineJS's). */
export interface NormalizeUrlOptions {
	/** Remove a leading `www.` from the host. */
	stripWWW?: boolean;
	/** Force this protocol (e.g. `"https"`). */
	forceProtocol?: string;
	/** Rewrite `http:` to `https:` (normalize-url `forceHttps`). */
	forceHttps?: boolean;
	/** Drop the trailing slash of an empty path. */
	stripTrailingSlash?: boolean;
	/** Drop the trailing slash of ANY path (normalize-url `removeTrailingSlash`). */
	removeTrailingSlash?: boolean;
	/** Drop the `#fragment`. */
	stripHash?: boolean;
	/** Drop the scheme entirely, leaving `example.com/path`. */
	stripProtocol?: boolean;
	/** Drop `user:pass@`. */
	stripAuthentication?: boolean;
	/** Drop `:80` / `:443` when they match the scheme's default. */
	removeExplicitPort?: boolean;
	/** Sort the query parameters by name, for a stable comparison key. */
	sortQueryParameters?: boolean;
	/** Query parameters to remove — names, or patterns matched against names. */
	removeQueryParameters?: ReadonlyArray<string | RegExp>;
	/** Drop `index.html` / `index.php`-style directory indexes. */
	removeDirectoryIndex?: boolean;
}

export function normalizeUrl(
	value: string,
	options: NormalizeUrlOptions = {},
): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		// Not parseable: hand it back untouched and let `url()` report the failure.
		return value;
	}
	if (options.forceProtocol) url.protocol = `${options.forceProtocol}:`;
	if (options.forceHttps && url.protocol === "http:") url.protocol = "https:";
	if (options.stripWWW) url.hostname = url.hostname.replace(/^www\./, "");
	if (options.stripHash) url.hash = "";
	if (options.stripAuthentication) {
		url.username = "";
		url.password = "";
	}
	if (
		options.removeExplicitPort &&
		((url.protocol === "http:" && url.port === "80") ||
			(url.protocol === "https:" && url.port === "443"))
	) {
		url.port = "";
	}
	if (options.removeDirectoryIndex) {
		url.pathname = url.pathname.replace(/\/index\.(?:html?|php|asp)$/i, "/");
	}
	for (const parameter of options.removeQueryParameters ?? []) {
		for (const name of [...url.searchParams.keys()]) {
			const matches =
				typeof parameter === "string"
					? name === parameter
					: parameter.test(name);
			if (matches) url.searchParams.delete(name);
		}
	}
	if (options.sortQueryParameters) url.searchParams.sort();

	let out = url.toString();
	if (options.removeTrailingSlash) {
		// Any path, not just the root one.
		out = out.replace(/\/(?=(?:\?|#|$))/, "");
	} else if (options.stripTrailingSlash && url.pathname === "/") {
		out = out.replace(/\/(?=(?:\?|#|$))/, "");
	}
	if (options.stripProtocol) out = out.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
	return out;
}

/** `dash-case`, `snake_case` and spaced words to `camelCase`. */
export function toCamelCase(v: string): string {
	return v
		.trim()
		.replace(/[-_\s]+(.)?/g, (_, c: string | undefined) =>
			c ? c.toUpperCase() : "",
		)
		.replace(/^(.)/, (c) => c.toLowerCase());
}

/**
 * Passport numbers. Named subset, same fail-closed contract as
 * {@link isPostalCode}: an unknown country returns `null`.
 */
const PASSPORTS: Record<string, RegExp> = {
	AT: /^[A-Z]\d{7}$/i,
	AU: /^[A-Z]\d{7}$/i,
	BE: /^[A-Z]{2}\d{6}$/i,
	CA: /^[A-Z]{2}\d{6}$/i,
	CH: /^[A-Z]\d{7}$/i,
	CZ: /^\d{8}$/,
	DE: /^[CFGHJKLMNPRTVWXYZ0-9]{9}$/i,
	DK: /^\d{9}$/,
	ES: /^[A-Z]{3}\d{6}$/i,
	FI: /^[A-Z]{2}\d{7}$/i,
	FR: /^\d{2}[A-Z]{2}\d{5}$/i,
	GB: /^\d{9}$/,
	GR: /^[A-Z]{2}\d{7}$/i,
	HU: /^[A-Z]{2}\d{6}$/i,
	IE: /^[A-Z0-9]{2}\d{7}$/i,
	IN: /^[A-Z]\d{7}$/i,
	IT: /^[A-Z0-9]{2}\d{7}$/i,
	JP: /^[A-Z]{2}\d{7}$/i,
	KR: /^[MS]\d{8}$/i,
	NL: /^[A-Z]{2}\d{6}[A-Z0-9]$/i,
	NO: /^\d{8}$/,
	PL: /^[A-Z]{2}\d{7}$/i,
	PT: /^[A-Z]\d{6}$/i,
	RO: /^\d{8,9}$/,
	RU: /^\d{9}$/,
	SE: /^\d{8}$/,
	TR: /^[A-Z]\d{8}$/i,
	UA: /^[A-Z]{2}\d{6}$/i,
	US: /^\d{9}$/,
	ZA: /^[TAMD]\d{8}$/i,
};

export const SUPPORTED_PASSPORTS = Object.keys(PASSPORTS);

export function isPassport(v: string, countryCode: string): boolean | null {
	const re = PASSPORTS[countryCode.toUpperCase()];
	return re === undefined ? null : re.test(v.trim());
}

/** Options accepted by `alpha()` / `alphaNumeric()` (VineJS spelling). */
export interface AlphaOptions {
	allowSpaces?: boolean;
	allowUnderscores?: boolean;
	allowDashes?: boolean;
}

/** Build the character class for `alpha`/`alphaNumeric` from its options. */
export function alphaPattern(base: string, options: AlphaOptions = {}): RegExp {
	let extra = "";
	if (options.allowSpaces) extra += " ";
	if (options.allowUnderscores) extra += "_";
	if (options.allowDashes) extra += "\\-";
	return new RegExp(`^[${base}${extra}]+$`);
}

/** Options accepted by `url()` — the validator.js names VineJS forwards. */
export interface UrlOptions {
	/** validator.js spelling — takes precedence over the camelCase alias. */
	require_protocol?: boolean;
	/** validator.js spelling. */
	require_tld?: boolean;
	/** validator.js spelling. */
	allow_underscores?: boolean;
	/** Require an explicit scheme. Defaults to `true`, like validator.js. */
	requireProtocol?: boolean;
	/** Allowed schemes, without the colon. Defaults to http/https. */
	protocols?: string[];
	/** Require a dotted host (rejects `http://localhost`). Defaults to `true`. */
	requireTld?: boolean;
	/** Allow `_` in the host. */
	allowUnderscores?: boolean;
}

export function isUrlWithOptions(
	value: string,
	options: UrlOptions = {},
): boolean {
	// VineJS forwards validator.js options verbatim, so a transcribed Adonis
	// validator arrives in snake_case. Both spellings are honoured, snake_case
	// first, so neither form is silently ignored.
	const requireProtocol =
		(options.require_protocol ?? options.requireProtocol) !== false;
	const protocols = options.protocols ?? ["http", "https"];
	const candidate =
		requireProtocol || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
			? value
			: `https://${value}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return false;
	}
	if (requireProtocol && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
	if (!protocols.includes(url.protocol.replace(/:$/, ""))) return false;
	if (url.hostname.length === 0) return false;
	const allowUnderscores =
		options.allow_underscores ?? options.allowUnderscores ?? false;
	if (!allowUnderscores && url.hostname.includes("_")) return false;
	const requireTld = (options.require_tld ?? options.requireTld) !== false;
	if (requireTld && !url.hostname.includes(".")) return false;
	return true;
}

/**
 * Mobile numbering plans. Named subset of VineJS's `locale` table, same
 * fail-closed contract as the postal codes: an unknown locale returns `null`.
 */
const MOBILE_LOCALES: Record<string, RegExp> = {
	"fr-CH": /^(?:\+41|0)7[5-9]\d{7}$/,
	"de-CH": /^(?:\+41|0)7[5-9]\d{7}$/,
	"it-CH": /^(?:\+41|0)7[5-9]\d{7}$/,
	"fr-FR": /^(?:\+33|0)[67]\d{8}$/,
	"fr-BE": /^(?:\+32|0)4[5-9]\d{7}$/,
	"nl-BE": /^(?:\+32|0)4[5-9]\d{7}$/,
	"en-US": /^(?:\+1)?[2-9]\d{9}$/,
	"en-CA": /^(?:\+1)?[2-9]\d{9}$/,
	"en-GB": /^(?:\+44|0)7\d{9}$/,
	"en-IE": /^(?:\+353|0)8[35-9]\d{7}$/,
	"en-AU": /^(?:\+61|0)4\d{8}$/,
	"en-NZ": /^(?:\+64|0)2\d{7,9}$/,
	"en-IN": /^(?:\+91|0)?[6-9]\d{9}$/,
	"de-DE": /^(?:\+49|0)1[5-7]\d{8,9}$/,
	"de-AT": /^(?:\+43|0)6[4-9]\d{7,10}$/,
	"it-IT": /^(?:\+39)?3\d{8,9}$/,
	"es-ES": /^(?:\+34)?[679]\d{8}$/,
	"pt-PT": /^(?:\+351)?9[1236]\d{7}$/,
	"pt-BR": /^(?:\+55)?(?:\d{2})?9?\d{8}$/,
	"nl-NL": /^(?:\+31|0)6\d{8}$/,
	"da-DK": /^(?:\+45)?\d{8}$/,
	"sv-SE": /^(?:\+46|0)7[02369]\d{7}$/,
	"nb-NO": /^(?:\+47)?[49]\d{7}$/,
	"fi-FI": /^(?:\+358|0)4\d{5,10}$/,
	"pl-PL": /^(?:\+48)?\d{9}$/,
	"cs-CZ": /^(?:\+420)?[6-7]\d{8}$/,
	"sk-SK": /^(?:\+421)?9\d{8}$/,
	"hu-HU": /^(?:\+36|06)(?:20|30|31|50|70)\d{7}$/,
	"ro-RO": /^(?:\+40|0)7\d{8}$/,
	"el-GR": /^(?:\+30|0)6[89]\d{8}$/,
	"tr-TR": /^(?:\+90|0)5\d{9}$/,
	"ru-RU": /^(?:\+7|8)9\d{9}$/,
	"uk-UA": /^(?:\+380|0)\d{9}$/,
	"ja-JP": /^(?:\+81|0)[7-9]0\d{8}$/,
	"ko-KR": /^(?:\+82|0)1[0-9]\d{7,8}$/,
	"zh-CN": /^(?:\+86|0)?1[3-9]\d{9}$/,
	"zh-TW": /^(?:\+886|0)9\d{8}$/,
	"ar-AE": /^(?:\+971|0)5[0245678]\d{7}$/,
	"ar-SA": /^(?:\+966|0)5\d{8}$/,
	"he-IL": /^(?:\+972|0)5[0-9]\d{7}$/,
	"en-ZA": /^(?:\+27|0)[6-8]\d{8}$/,
};

export const SUPPORTED_MOBILE_LOCALES = Object.keys(MOBILE_LOCALES);

export function isMobileForLocale(v: string, locale: string): boolean | null {
	const re = MOBILE_LOCALES[locale];
	if (re === undefined) return null;
	return re.test(v.replace(/[ .-]/g, ""));
}

/**
 * Options accepted by `email()` — the validator.js names VineJS forwards.
 * Implemented here rather than delegated: rune carries no runtime dependency,
 * so every check it claims to do, it does itself.
 */
export interface EmailOptions {
	/** Accept `Name <a@b.io>`. Off by default. */
	allow_display_name?: boolean;
	/** Require a dotted domain. On by default. */
	require_tld?: boolean;
	/** Accept `user@[192.168.0.1]` / `user@[IPv6:…]`. Off by default. */
	allow_ip_domain?: boolean;
	/** Skip the RFC length caps (64 local / 254 total). Off by default. */
	ignore_max_length?: boolean;
	/** Characters refused anywhere in the local part. */
	blacklisted_chars?: string;
	/** Apply Gmail's own extra restrictions when the domain is Gmail. */
	domain_specific_validation?: boolean;
}

/** Hard bound on anything handed to the email parser (RFC 5322 line limit). */
const MAX_EMAIL_INPUT = 998;

/** Unquoted local part: dot-separated atoms of RFC 5322 atext. */
const ATEXT = "[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+";
const DOT_ATOM_RE = new RegExp(`^${ATEXT}(?:\\.${ATEXT})*$`);
/** Quoted local part: `"anything but bare quote/backslash, or escaped"`. */
const QUOTED_LOCAL_RE = /^"(?:[^"\\]|\\.)*"$/;
/**
 * Split `Display Name <address@host>` into its address.
 *
 * Parsed rather than matched: the obvious pattern —
 * `^\s*(?:"..."|[^<>@]*?)\s*<(.+)>\s*$` — lets `\s*` and `[^<>@]*?` both
 * claim a space, so an input of N spaces has N ways to be split and the engine
 * tries them all. Measured at O(n³): 8 KB of spaces blocked the event loop for
 * 67 seconds, which turns any route validating an email into a denial of
 * service. This walk is linear and answers the same question.
 *
 * Returns the address, or null when the input is not in display-name form.
 */
function displayNameAddress(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed.endsWith(">")) return null;

	let open: number;
	if (trimmed.startsWith('"')) {
		// A quoted display name may contain anything, `<` included, so the
		// address opens at the first `<` AFTER the closing quote.
		const closingQuote = closingQuoteIndex(trimmed);
		if (closingQuote === -1) return null;
		open = trimmed.indexOf("<", closingQuote + 1);
		if (open === -1) return null;
		if (trimmed.slice(closingQuote + 1, open).trim() !== "") return null;
	} else {
		open = trimmed.indexOf("<");
		if (open === -1) return null;
		// An unquoted display name carries none of `<`, `>` or `@` — the same
		// restriction the pattern expressed.
		if (/[<>@]/.test(trimmed.slice(0, open))) return null;
	}

	const address = trimmed.slice(open + 1, -1);
	return address.length > 0 ? address : null;
}

/** Index of the quote closing the one at position 0, or -1. */
function closingQuoteIndex(input: string): number {
	for (let i = 1; i < input.length; i++) {
		if (input[i] === "\\") {
			i++;
			continue;
		}
		if (input[i] === '"') return i;
	}
	return -1;
}

/** A single DNS label: alphanumerics and inner hyphens, 1..63 chars. */
function isDnsLabel(label: string): boolean {
	if (label.length === 0 || label.length > 63) return false;
	if (label.startsWith("-") || label.endsWith("-")) return false;
	return /^[a-zA-Z0-9-]+$/.test(label);
}

/** Bracketed IP domain literal — `[192.168.0.1]` or `[IPv6:::1]`. */
function isIpDomainLiteral(domain: string): boolean {
	if (!domain.startsWith("[") || !domain.endsWith("]")) return false;
	const inner = domain.slice(1, -1);
	if (inner.toLowerCase().startsWith("ipv6:")) {
		return isIpAddress(inner.slice(5), 6);
	}
	return isIpAddress(inner, 4);
}

/**
 * Validate an email address.
 *
 * Deliberately structural rather than one giant regex: the length caps, the
 * quoted local part and the IP-literal domain are separate rules in RFC 5321,
 * and a single pattern that tries to express all of them is the classic source
 * of both false accepts and false rejects.
 */
export function isEmail(value: string, options: EmailOptions = {}): boolean {
	let candidate = value;

	// Bound the input BEFORE any parsing. A caller may opt out of the 254-char
	// address cap, but never out of a bound: an unbounded string reaching the
	// parser is how a validator becomes an outage. RFC 5322 caps a whole line
	// at 998 octets, so a display-name form has no business being longer.
	if (value.length > MAX_EMAIL_INPUT) return false;

	if (options.allow_display_name) {
		const address = displayNameAddress(candidate);
		if (address !== null) candidate = address;
	} else if (/[<>]/.test(candidate)) {
		return false;
	}

	if (!options.ignore_max_length && candidate.length > 254) return false;

	const at = candidate.lastIndexOf("@");
	if (at < 1 || at === candidate.length - 1) return false;
	const local = candidate.slice(0, at);
	const domain = candidate.slice(at + 1);

	if (options.blacklisted_chars) {
		for (const char of options.blacklisted_chars) {
			if (local.includes(char)) return false;
		}
	}

	const quoted = QUOTED_LOCAL_RE.test(local);
	if (!quoted && !DOT_ATOM_RE.test(local)) return false;
	if (!options.ignore_max_length && local.length > 64) return false;

	if (domain.startsWith("[")) {
		return options.allow_ip_domain === true && isIpDomainLiteral(domain);
	}

	const labels = domain.split(".");
	if (options.require_tld !== false) {
		if (labels.length < 2) return false;
		// A TLD is alphabetic and at least two characters.
		const tld = labels[labels.length - 1];
		if (tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) return false;
	}
	if (!labels.every(isDnsLabel)) return false;

	if (
		options.domain_specific_validation &&
		GMAIL_DOMAINS.has(domain.toLowerCase())
	) {
		// Gmail: 6..30 chars, letters/digits/dots only, no leading/trailing dot,
		// no doubled dot — and dots are ignored for the length check.
		const username = local.split("+")[0];
		if (!/^[a-zA-Z0-9.]+$/.test(username)) return false;
		if (username.startsWith(".") || username.endsWith(".")) return false;
		if (username.includes("..")) return false;
		const bare = username.replace(/\./g, "");
		if (bare.length < 6 || bare.length > 30) return false;
	}

	return true;
}

/** Options accepted by `vat()` (VineJS 4.2 `vatRule`). */
export interface VatOptions {
	countryCode: string | string[];
}

/**
 * VAT number patterns, per country. `check` runs the country's own checksum
 * when there is a short, well-defined one; countries without a `check` are
 * validated on FORMAT only, and that is stated rather than implied.
 */
const VAT_RULES: Record<
	string,
	{ pattern: RegExp; check?: (digits: string) => boolean }
> = {
	// mod-97 on the 9 leading digits (the two check digits are the last two).
	BE: {
		pattern: /^BE0?\d{9}$/i,
		check: (d) => mod97(d.slice(0, 8)) === Number(d.slice(8, 10)),
	},
	FR: { pattern: /^FR[0-9A-Z]{2}\d{9}$/i },
	DE: { pattern: /^DE\d{9}$/i, check: (d) => germanChecksum(d) },
	NL: { pattern: /^NL\d{9}B\d{2}$/i, check: (d) => dutchChecksum(d) },
	IT: { pattern: /^IT\d{11}$/i, check: (d) => luhnLike(d) },
	ES: { pattern: /^ES[0-9A-Z]\d{7}[0-9A-Z]$/i },
	PT: { pattern: /^PT\d{9}$/i, check: (d) => mod11(d) },
	LU: {
		pattern: /^LU\d{8}$/i,
		check: (d) => Number(d.slice(0, 6)) % 89 === Number(d.slice(6, 8)),
	},
	AT: { pattern: /^ATU\d{8}$/i },
	DK: { pattern: /^DK\d{8}$/i },
	FI: { pattern: /^FI\d{8}$/i },
	SE: { pattern: /^SE\d{12}$/i },
	IE: { pattern: /^IE(?:\d{7}[A-W]{1,2}|\d[A-Z+*]\d{5}[A-W])$/i },
	PL: { pattern: /^PL\d{10}$/i },
	CZ: { pattern: /^CZ\d{8,10}$/i },
	SK: { pattern: /^SK\d{10}$/i },
	GR: { pattern: /^(?:EL|GR)\d{9}$/i },
	HU: { pattern: /^HU\d{8}$/i },
	RO: { pattern: /^RO\d{2,10}$/i },
	BG: { pattern: /^BG\d{9,10}$/i },
	HR: { pattern: /^HR\d{11}$/i },
	SI: { pattern: /^SI\d{8}$/i },
	EE: { pattern: /^EE\d{9}$/i },
	LV: { pattern: /^LV\d{11}$/i },
	LT: { pattern: /^LT(?:\d{9}|\d{12})$/i },
	MT: { pattern: /^MT\d{8}$/i },
	CY: { pattern: /^CY\d{8}[A-Z]$/i },
	GB: { pattern: /^GB(?:\d{9}|\d{12}|GD\d{3}|HA\d{3})$/i },
	CH: {
		pattern: /^CHE\d{9}(?:TVA|MWST|IVA)?$/i,
		check: (d) => swissUidChecksum(d),
	},
};

/** Countries `vat()` can check. */
export const SUPPORTED_VAT_COUNTRIES = Object.keys(VAT_RULES);

/** Plain mod-97 over a digit string. */
function mod97(digits: string): number {
	let remainder = 0;
	for (const digit of digits) {
		remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
	}
	return 97 - remainder;
}

/** ISO 7064 mod-11 used by the Portuguese NIF. */
function mod11(digits: string): boolean {
	let sum = 0;
	for (let i = 0; i < 8; i++) {
		sum += (digits.charCodeAt(i) - 48) * (9 - i);
	}
	const check = 11 - (sum % 11);
	const expected = check >= 10 ? 0 : check;
	return expected === digits.charCodeAt(8) - 48;
}

/** German USt-IdNr. checksum (the "11-test" defined by the Bundeszentralamt). */
function germanChecksum(digits: string): boolean {
	let product = 10;
	for (let i = 0; i < 8; i++) {
		const digit = digits.charCodeAt(i) - 48;
		let sum = (digit + product) % 10;
		if (sum === 0) sum = 10;
		product = (2 * sum) % 11;
	}
	const check = 11 - product;
	return (check === 10 ? 0 : check) === digits.charCodeAt(8) - 48;
}

/** Dutch BTW checksum: weighted 9..2 mod 11 over the first 8 digits. */
function dutchChecksum(digits: string): boolean {
	let sum = 0;
	for (let i = 0; i < 8; i++) {
		sum += (digits.charCodeAt(i) - 48) * (9 - i);
	}
	return sum % 11 === digits.charCodeAt(8) - 48;
}

/** Italian partita IVA: Luhn over 11 digits. */
function luhnLike(digits: string): boolean {
	let sum = 0;
	for (let i = 0; i < 11; i++) {
		let digit = digits.charCodeAt(i) - 48;
		if (i % 2 === 1) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
	}
	return sum % 10 === 0;
}

/** Swiss UID (CHE): weights 5,4,3,2,7,6,5,4 mod 11. */
function swissUidChecksum(digits: string): boolean {
	const weights = [5, 4, 3, 2, 7, 6, 5, 4];
	let sum = 0;
	for (let i = 0; i < 8; i++) {
		sum += (digits.charCodeAt(i) - 48) * weights[i];
	}
	const remainder = sum % 11;
	if (remainder === 10) return false;
	const check = remainder === 0 ? 0 : 11 - remainder;
	return check === digits.charCodeAt(8) - 48;
}

/**
 * Validate a VAT number for one country. Returns `null` when the country has no
 * rule, so the caller can fail LOUDLY instead of accepting the value.
 */
export function isVat(value: string, countryCode: string): boolean | null {
	const rule = VAT_RULES[countryCode.toUpperCase()];
	if (rule === undefined) return null;
	const normalized = value.replace(/[\s.-]/g, "").toUpperCase();
	if (!rule.pattern.test(normalized)) return false;
	if (!rule.check) return true;
	const digits = normalized.replace(/[^0-9]/g, "");
	return rule.check(digits);
}
