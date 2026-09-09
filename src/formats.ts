/**
 * Format validators backing the VineJS string/number/array rules.
 *
 * VineJS delegates these to `validator.js`. rune has zero runtime dependencies,
 * so each check is implemented here. The per-locale tables (mobile numbers,
 * postal codes, passports, VAT) are transcribed in `tables.ts`, and an unknown
 * locale **fails closed** rather than waving the value through — an unchecked
 * value that reports "valid" is the failure mode this package exists to
 * prevent.
 */

import {
	MOBILE_LOCALES,
	PASSPORTS,
	POSTAL_CODES,
	VAT_RULES,
} from "./tables.js";

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
	const [headPart = "", tailPart] = halves;
	const head = expand(headPart);
	const tail = tailPart === undefined ? [] : expand(tailPart);
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
	const [latRaw, lngRaw] = parts;
	if (latRaw === undefined || lngRaw === undefined) return false;
	const lat = Number(latRaw.trim());
	const lng = Number(lngRaw.trim());
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Country codes rune can check postal codes for. */
export const SUPPORTED_POSTAL_CODES = Object.keys(POSTAL_CODES);

/**
 * Validate a postal code for one country. `null` for a country rune has no
 * pattern for, so the caller can fail LOUDLY instead of accepting the value.
 *
 * The code is matched AS WRITTEN, like validator.js — every pattern already
 * states the separators and spacing its country allows.
 */
export function isPostalCode(v: string, countryCode: string): boolean | null {
	const re = POSTAL_CODES[countryCode.toUpperCase()];
	return re === undefined ? null : re.test(v);
}

/**
 * The locale-less check behind `mobile()` with no `locale` — VineJS's `"any"`:
 * the number matches SOME numbering plan.
 *
 * Named addition: a well-formed E.164 number is also accepted, so a number for
 * a country no table covers is not refused for want of a plan.
 */
export const isMobile = (v: string): boolean =>
	Object.values(MOBILE_LOCALES).some((re) => re.test(v)) ||
	E164_RE.test(v.replace(/[ .-]/g, ""));

/** HTML-escape the five characters that break out of markup (VineJS `escape`). */
export function escapeHtml(v: string): string {
	return v
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\//g, "&#x2F;")
		.replace(/\\/g, "&#x5C;")
		.replace(/`/g, "&#96;");
}

/**
 * Options accepted by `normalizeEmail`, in validator.js's spelling — the names
 * VineJS forwards. Every one defaults to `true`, as it does there: normalising
 * is what the caller asked for, so the provider-specific rules are ON and an
 * option is how you turn one OFF.
 */
export interface NormalizeEmailOptions {
	/** Lowercase the local part of every address. */
	all_lowercase?: boolean;
	/** Lowercase the local part of a Gmail address. */
	gmail_lowercase?: boolean;
	/** Strip dots from a Gmail local part (`a.b@gmail.com` → `ab@gmail.com`). */
	gmail_remove_dots?: boolean;
	/** Drop a `+tag` suffix from a Gmail local part. */
	gmail_remove_subaddress?: boolean;
	/** Rewrite the `googlemail.com` domain to `gmail.com`. */
	gmail_convert_googlemaildotcom?: boolean;
	/** Lowercase the local part of an Outlook.com address. */
	outlookdotcom_lowercase?: boolean;
	/** Drop a `+tag` suffix from an Outlook.com local part. */
	outlookdotcom_remove_subaddress?: boolean;
	/** Lowercase the local part of a Yahoo address. */
	yahoo_lowercase?: boolean;
	/** Drop a `-tag` suffix from a Yahoo local part. */
	yahoo_remove_subaddress?: boolean;
	/** Lowercase the local part of a Yandex address. */
	yandex_lowercase?: boolean;
	/** Rewrite every Yandex domain to `yandex.ru`. */
	yandex_convert_yandexru?: boolean;
	/** Lowercase the local part of an iCloud address. */
	icloud_lowercase?: boolean;
	/** Drop a `+tag` suffix from an iCloud local part. */
	icloud_remove_subaddress?: boolean;
	/** camelCase alias for {@link NormalizeEmailOptions.all_lowercase}. */
	allLowercase?: boolean;
	/** camelCase alias for {@link NormalizeEmailOptions.gmail_remove_dots}. */
	gmailRemoveDots?: boolean;
	/** camelCase alias for {@link NormalizeEmailOptions.gmail_remove_subaddress}. */
	gmailRemoveSubaddress?: boolean;
}

const GMAIL_DOMAINS = ["gmail.com", "googlemail.com"];
const ICLOUD_DOMAINS = ["icloud.com", "me.com"];
const YAHOO_DOMAINS = [
	"rocketmail.com",
	"yahoo.ca",
	"yahoo.co.uk",
	"yahoo.com",
	"yahoo.de",
	"yahoo.fr",
	"yahoo.in",
	"yahoo.it",
	"ymail.com",
];
const YANDEX_DOMAINS = [
	"yandex.ru",
	"yandex.ua",
	"yandex.kz",
	"yandex.com",
	"yandex.by",
	"ya.ru",
];
/** Outlook.com and its predecessors. Incomplete upstream, and kept verbatim. */
const OUTLOOK_DOMAINS = [
	"hotmail.at",
	"hotmail.be",
	"hotmail.ca",
	"hotmail.cl",
	"hotmail.co.il",
	"hotmail.co.nz",
	"hotmail.co.th",
	"hotmail.co.uk",
	"hotmail.com",
	"hotmail.com.ar",
	"hotmail.com.au",
	"hotmail.com.br",
	"hotmail.com.gr",
	"hotmail.com.mx",
	"hotmail.com.pe",
	"hotmail.com.tr",
	"hotmail.com.vn",
	"hotmail.cz",
	"hotmail.de",
	"hotmail.dk",
	"hotmail.es",
	"hotmail.fr",
	"hotmail.hu",
	"hotmail.id",
	"hotmail.ie",
	"hotmail.in",
	"hotmail.it",
	"hotmail.jp",
	"hotmail.kr",
	"hotmail.lv",
	"hotmail.my",
	"hotmail.ph",
	"hotmail.pt",
	"hotmail.sa",
	"hotmail.sg",
	"hotmail.sk",
	"live.be",
	"live.co.uk",
	"live.com",
	"live.com.ar",
	"live.com.mx",
	"live.de",
	"live.es",
	"live.eu",
	"live.fr",
	"live.it",
	"live.nl",
	"msn.com",
	"outlook.at",
	"outlook.be",
	"outlook.cl",
	"outlook.co.il",
	"outlook.co.nz",
	"outlook.co.th",
	"outlook.com",
	"outlook.com.ar",
	"outlook.com.au",
	"outlook.com.br",
	"outlook.com.gr",
	"outlook.com.pe",
	"outlook.com.tr",
	"outlook.com.vn",
	"outlook.cz",
	"outlook.de",
	"outlook.dk",
	"outlook.es",
	"outlook.fr",
	"outlook.hu",
	"outlook.id",
	"outlook.ie",
	"outlook.in",
	"outlook.it",
	"outlook.jp",
	"outlook.kr",
	"outlook.lv",
	"outlook.my",
	"outlook.ph",
	"outlook.pt",
	"outlook.sa",
	"outlook.sg",
	"outlook.sk",
	"passport.com",
];

/**
 * Normalise an address to the form its provider actually delivers to
 * (VineJS `normalizeEmail`, which delegates to validator.js).
 *
 * Named deviation: validator.js returns `false` when the rules empty the local
 * part. That can only happen for an address `email()` would already have
 * refused, and putting a boolean where a string was is worse than doing
 * nothing, so rune hands the value back untouched instead.
 */
export function normalizeEmail(
	value: string,
	options: NormalizeEmailOptions = {},
): string {
	const on = (
		key: keyof NormalizeEmailOptions,
		alias?: keyof NormalizeEmailOptions,
	): boolean =>
		(options[key] ?? (alias ? options[alias] : undefined)) !== false;
	const allLowercase = on("all_lowercase", "allLowercase");

	const parts = value.split("@");
	const rawDomain = parts.pop();
	if (rawDomain === undefined || parts.length === 0) return value;
	let local = parts.join("@");
	// The domain is case-insensitive per RFC 1035, so it is always lowercased.
	let domain = rawDomain.toLowerCase();

	/** Strip a subaddress introduced by `separator`, keeping what precedes it. */
	const withoutSubaddress = (separator: string): string => {
		const components = local.split(separator);
		return components.length > 1
			? components.slice(0, -1).join(separator)
			: (components[0] ?? local);
	};

	if (GMAIL_DOMAINS.includes(domain)) {
		if (on("gmail_remove_subaddress", "gmailRemoveSubaddress")) {
			local = local.split("+")[0] ?? local;
		}
		if (on("gmail_remove_dots", "gmailRemoveDots")) {
			// Consecutive dots are NOT collapsed: Gmail treats `a..b` as its own
			// address, so removing them would normalise to a different mailbox.
			local = local.replace(/\.+/g, (run) => (run.length > 1 ? run : ""));
		}
		if (local.length === 0) return value;
		if (allLowercase || on("gmail_lowercase")) local = local.toLowerCase();
		if (on("gmail_convert_googlemaildotcom")) domain = "gmail.com";
	} else if (ICLOUD_DOMAINS.includes(domain)) {
		if (on("icloud_remove_subaddress")) local = local.split("+")[0] ?? local;
		if (local.length === 0) return value;
		if (allLowercase || on("icloud_lowercase")) local = local.toLowerCase();
	} else if (OUTLOOK_DOMAINS.includes(domain)) {
		if (on("outlookdotcom_remove_subaddress")) {
			local = local.split("+")[0] ?? local;
		}
		if (local.length === 0) return value;
		if (allLowercase || on("outlookdotcom_lowercase")) {
			local = local.toLowerCase();
		}
	} else if (YAHOO_DOMAINS.includes(domain)) {
		// Yahoo's subaddress separator is `-`, and it is the LAST one that counts.
		if (on("yahoo_remove_subaddress")) local = withoutSubaddress("-");
		if (local.length === 0) return value;
		if (allLowercase || on("yahoo_lowercase")) local = local.toLowerCase();
	} else if (YANDEX_DOMAINS.includes(domain)) {
		if (allLowercase || on("yandex_lowercase")) local = local.toLowerCase();
		if (on("yandex_convert_yandexru")) domain = "yandex.ru";
	} else if (allLowercase) {
		local = local.toLowerCase();
	}
	return `${local}@${domain}`;
}

export {
	type EmptyQueryValue,
	type NormalizeUrlOptions,
	normalizeUrl,
	type ParameterFilter,
} from "./normalize-url.js";

/** `dash-case`, `snake_case` and spaced words to `camelCase`. */
export function toCamelCase(v: string): string {
	return v
		.trim()
		.replace(/[-_\s]+(.)?/g, (_, c: string | undefined) =>
			c ? c.toUpperCase() : "",
		)
		.replace(/^(.)/, (c) => c.toLowerCase());
}

/** Countries `passport()` can check. */
export const SUPPORTED_PASSPORTS = Object.keys(PASSPORTS);

/**
 * Validate a passport number for one country. Whitespace is removed and the
 * value uppercased first, as validator.js does.
 */
export function isPassport(v: string, countryCode: string): boolean | null {
	const re = PASSPORTS[countryCode.toUpperCase()];
	if (re === undefined) return null;
	return re.test(v.replace(/\s/g, "").toUpperCase());
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

/** Locales `mobile()` can check a numbering plan for. */
export const SUPPORTED_MOBILE_LOCALES = Object.keys(MOBILE_LOCALES);

/**
 * Match one locale's numbering plan. `null` for a locale rune has no plan for,
 * so the caller can fail LOUDLY instead of accepting the value.
 *
 * The number is matched AS WRITTEN, like validator.js: every plan already
 * states the separators it allows.
 */
export function isMobileForLocale(v: string, locale: string): boolean | null {
	const re = MOBILE_LOCALES[locale];
	if (re === undefined) return null;
	return re.test(v);
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
		const tld = labels.at(-1) ?? "";
		if (tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) return false;
	}
	if (!labels.every(isDnsLabel)) return false;

	if (
		options.domain_specific_validation &&
		GMAIL_DOMAINS.includes(domain.toLowerCase())
	) {
		// Gmail: 6..30 chars, letters/digits/dots only, no leading/trailing dot,
		// no doubled dot — and dots are ignored for the length check.
		const username = local.split("+")[0] ?? local;
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

/** Countries `vat()` can check. */
export const SUPPORTED_VAT_COUNTRIES = Object.keys(VAT_RULES);

/**
 * Validate a VAT number for one country. Returns `null` when the country has no
 * rule, so the caller can fail LOUDLY instead of accepting the value.
 *
 * Four attempts, and the value is accepted if any lands: each pattern is tried
 * against the value AS WRITTEN and against a form stripped of separators and
 * uppercased.
 *
 * `pattern` is the country's shape as VineJS validates it. `legacy` is the
 * shape rune validated before those were transcribed — kept because the two
 * disagree in both directions (VineJS's `GB` demands the spaces, rune's `IE`
 * knows the old-style number) and dropping either would refuse numbers one of
 * them accepts today. Matching as written is what VineJS does; the stripped
 * retry is rune's own tolerance, and it is why `BY` still works — its prefix
 * carries a space no register writes twice.
 */
export function isVat(value: string, countryCode: string): boolean | null {
	const rule = VAT_RULES[countryCode.toUpperCase()];
	if (rule === undefined) return null;
	const stripped = value.replace(/[\s.-]/g, "").toUpperCase();
	const matches = [value, stripped].some(
		(candidate) =>
			rule.pattern.test(candidate) || (rule.legacy?.test(candidate) ?? false),
	);
	if (!matches) return false;
	if (!rule.check) return true;
	return rule.check(value.replace(/\D/g, ""));
}
