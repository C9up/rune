/**
 * URL normalisation, as VineJS's `normalizeUrl()` performs it.
 *
 * VineJS delegates to the `normalize-url` package. rune has zero runtime
 * dependencies, so the algorithm is transcribed here from normalize-url 9.0.1 —
 * same options, same defaults, same output.
 *
 * Portions derived from normalize-url, Copyright (c) Sindre Sorhus, MIT
 * licence. See LICENSE-THIRD-PARTY.md.
 */

const DATA_URL_DEFAULT_MIME_TYPE = "text/plain";
const DATA_URL_DEFAULT_CHARSET = "us-ascii";

const ENCODED_RESERVED =
	"%(?:3A|2F|3F|23|5B|5D|40|21|24|26|27|28|29|2A|2B|2C|3B|3D)";
const TOKEN_BASE = "__normalize_url_encoded_reserved__";
const TOKEN_PATTERN = /__normalize_url_encoded_reserved__(\d+)__/g;
const HAS_ENCODED_RESERVED = new RegExp(ENCODED_RESERVED, "i");
const ENCODED_RESERVED_GLOBAL = new RegExp(ENCODED_RESERVED, "gi");

/** A name filter: an exact name, or a pattern matched against it. */
export type ParameterFilter = string | RegExp;

/** How an empty query value is written back. */
export type EmptyQueryValue = "preserve" | "always" | "never";

/** Options accepted by `normalizeUrl` — normalize-url's, plus two rune keeps. */
export interface NormalizeUrlOptions {
	/** Protocol prepended to a URL that carries none. Default `"http"`. */
	defaultProtocol?: string;
	/** Rewrite a protocol-relative `//host` to the default protocol. Default `true`. */
	normalizeProtocol?: boolean;
	/** Rewrite `https:` to `http:`. Cannot be combined with `forceHttps`. */
	forceHttp?: boolean;
	/** Rewrite `http:` to `https:`. */
	forceHttps?: boolean;
	/** Drop `user:pass@`. Default `true`. */
	stripAuthentication?: boolean;
	/** Drop the `#fragment`. */
	stripHash?: boolean;
	/** Drop a `#:~:text=` scroll-to-text fragment. Default `true`. */
	stripTextFragment?: boolean;
	/** Drop a leading `www.` from the host. Default `true`. */
	stripWWW?: boolean;
	/** Drop the scheme entirely, leaving `example.com/path`. */
	stripProtocol?: boolean;
	/** Parameters to remove, or `true` for all. Default `[/^utm_\w+/i]`. */
	removeQueryParameters?: readonly ParameterFilter[] | true;
	/** Parameters to KEEP; everything else goes. Wins over `removeQueryParameters`. */
	keepQueryParameters?: readonly ParameterFilter[];
	/** Drop the path's trailing slash. Default `true`. */
	removeTrailingSlash?: boolean;
	/** Drop a lone `/` path. Default `true`. */
	removeSingleSlash?: boolean;
	/** Drop a directory index — `true` for `index.*`, or your own filters. */
	removeDirectoryIndex?: boolean | readonly ParameterFilter[];
	/** Drop an explicit port. */
	removeExplicitPort?: boolean;
	/** Sort the query parameters by name. Default `true`. */
	sortQueryParameters?: boolean;
	/** Reduce the path to `/`. */
	removePath?: boolean;
	/** Rewrite the path's components. */
	transformPath?: (components: string[]) => string[] | undefined;
	/** Whether an empty value keeps its `=`. Default `"preserve"`. */
	emptyQueryValue?: EmptyQueryValue;
	/** Protocols to normalise rather than hand back untouched. */
	customProtocols?: readonly string[];
	/** rune keep: force this protocol outright (e.g. `"https"`). */
	forceProtocol?: string;
	/** rune keep: alias of {@link NormalizeUrlOptions.removeSingleSlash}. */
	stripTrailingSlash?: boolean;
}

const DEFAULTS = {
	defaultProtocol: "http",
	normalizeProtocol: true,
	forceHttp: false,
	forceHttps: false,
	stripAuthentication: true,
	stripHash: false,
	stripTextFragment: true,
	stripWWW: true,
	removeQueryParameters: [/^utm_\w+/i],
	removeTrailingSlash: true,
	removeSingleSlash: true,
	removeDirectoryIndex: false,
	removeExplicitPort: false,
	sortQueryParameters: true,
	removePath: false,
	emptyQueryValue: "preserve",
} satisfies NormalizeUrlOptions;

/** Does `name` match any of the filters? A global pattern is de-globbed first. */
function testParameter(
	name: string,
	filters: readonly ParameterFilter[] | undefined,
): boolean {
	if (!Array.isArray(filters)) return false;
	return filters.some((filter) => {
		if (filter instanceof RegExp) {
			// A `g`/`y` pattern carries lastIndex between calls, which would make
			// the answer depend on the order names are tested in.
			if (filter.flags.includes("g") || filter.flags.includes("y")) {
				return new RegExp(
					filter.source,
					filter.flags.replace(/[gy]/g, ""),
				).test(name);
			}
			return filter.test(name);
		}
		return filter === name;
	});
}

const SUPPORTED_PROTOCOLS = new Set(["https:", "http:", "file:"]);

function normalizeCustomProtocolOption(protocol: string): string | undefined {
	const normalized = protocol.trim().toLowerCase().replace(/:$/, "");
	return normalized === "" ? undefined : `${normalized}:`;
}

/** The protocol of a URL rune should hand back untouched, if there is one. */
function getCustomProtocol(urlString: string): string | undefined {
	try {
		const { protocol } = new URL(urlString);
		const hasAuthority =
			urlString.slice(0, protocol.length + 2).toLowerCase() === `${protocol}//`;
		// `localhost:9802` is a host and a port, not a protocol and a path.
		if (
			protocol === "localhost:" &&
			!hasAuthority &&
			/^\d{1,5}([/?#]|$)/.test(urlString.slice(protocol.length))
		) {
			return undefined;
		}
		if (
			protocol.endsWith(":") &&
			(!protocol.includes(".") || hasAuthority) &&
			!SUPPORTED_PROTOCOLS.has(protocol)
		) {
			return protocol;
		}
	} catch {
		// Not parseable: it carries no protocol worth preserving.
	}
	return undefined;
}

function decodeQueryKey(value: string): string {
	try {
		return decodeURIComponent(value.replaceAll("+", "%20"));
	} catch {
		// Match URLSearchParams' behaviour for malformed percent-encoding.
		return new URLSearchParams(`${value}=`).keys().next().value ?? value;
	}
}

/** The keys written without an `=`, so `preserve` can put them back that way. */
function getKeysWithoutEquals(search: string): Set<string> {
	const keys = new Set<string>();
	if (!search) return keys;
	for (const part of search.slice(1).split("&")) {
		if (part && !part.includes("=")) keys.add(decodeQueryKey(part));
	}
	return keys;
}

/**
 * A token prefix no query string already contains, so the placeholder we swap
 * encoded reserved characters for cannot collide with real content.
 */
function temporaryTokenPrefix(search: string): string {
	let decoded = search;
	try {
		decoded = decodeURIComponent(search);
	} catch {
		decoded = new URLSearchParams(search).toString();
	}
	const used = new Set<number>();
	for (const value of [search, decoded]) {
		for (const match of value.matchAll(TOKEN_PATTERN)) {
			used.add(Number.parseInt(match[1] ?? "0", 10));
		}
	}
	let index = 0;
	while (used.has(index)) index++;
	return `${TOKEN_BASE}${index}__`;
}

function decodeReservedTokens(
	value: string,
	tokenRegex: RegExp | undefined,
): string {
	if (!tokenRegex) return value;
	return value.replace(tokenRegex, (_, hex: string) =>
		String.fromCodePoint(Number.parseInt(hex, 16)),
	);
}

function sortSearchParameters(
	parameters: URLSearchParams,
	tokenRegex: RegExp | undefined,
): string {
	if (!tokenRegex) {
		parameters.sort();
		return parameters.toString();
	}
	const sortable = (key: string) => decodeReservedTokens(key, tokenRegex);
	const entries = [...parameters.entries()];
	entries.sort(([left], [right]) => {
		const a = sortable(left);
		const b = sortable(right);
		return a < b ? -1 : a > b ? 1 : 0;
	});
	return new URLSearchParams(entries).toString();
}

function normalizeEmptyQueryParameters(
	search: string,
	emptyQueryValue: EmptyQueryValue,
	originalSearch: string,
): string {
	const isAlways = emptyQueryValue === "always";
	const isNever = emptyQueryValue === "never";
	const keysWithoutEquals =
		isAlways || isNever ? undefined : getKeysWithoutEquals(originalSearch);

	// `+` means a space in a query string, so it is not a literal plus.
	const normalizeKey = (key: string) => key.replaceAll("+", "%20");
	const formatEmpty = (key: string): string => {
		if (isAlways) return `${key}=`;
		if (isNever) return key;
		return keysWithoutEquals?.has(decodeQueryKey(key)) ? key : `${key}=`;
	};
	const normalizeParameter = (parameter: string): string => {
		const equals = parameter.indexOf("=");
		if (equals === -1) return formatEmpty(normalizeKey(parameter));
		const key = parameter.slice(0, equals);
		const value = parameter.slice(equals + 1);
		if (value === "") {
			if (key === "") return "=";
			return formatEmpty(normalizeKey(key));
		}
		return `${normalizeKey(key)}=${value}`;
	};

	const parameters = search.slice(1).split("&").filter(Boolean);
	return parameters.length === 0
		? ""
		: `?${parameters.map(normalizeParameter).join("&")}`;
}

/** `data:` URLs are normalised on their media type, not as a hierarchical URL. */
function normalizeDataUrl(urlString: string, stripHash: boolean): string {
	const match = /^data:([^,]*?),([^#]*?)(?:#(.*))?$/.exec(urlString);
	if (!match) throw new Error(`Invalid URL: ${urlString}`);
	const type = match[1] ?? "";
	const data = match[2] ?? "";
	const hash = match[3];

	const mediaType = type.split(";");
	const isBase64 = mediaType.at(-1) === "base64";
	if (isBase64) mediaType.pop();

	const mimeType = (mediaType.shift() ?? "").toLowerCase();
	const attributes = mediaType
		.map((attribute) => {
			const [rawKey, rawValue] = attribute.split("=").map((s) => s.trim());
			const key = rawKey ?? "";
			let value = rawValue ?? "";
			if (key === "charset") {
				value = value.toLowerCase();
				if (value === DATA_URL_DEFAULT_CHARSET) return "";
			}
			return `${key}${value ? `=${value}` : ""}`;
		})
		.filter(Boolean);

	const normalized = [...attributes];
	if (isBase64) normalized.push("base64");
	if (
		normalized.length > 0 ||
		(mimeType && mimeType !== DATA_URL_DEFAULT_MIME_TYPE)
	) {
		normalized.unshift(mimeType);
	}
	const hashPart = stripHash || !hash ? "" : `#${hash}`;
	return `data:${normalized.join(";")},${isBase64 ? data.trim() : data}${hashPart}`;
}

/** Collapse repeated slashes, leaving any embedded `scheme://` intact. */
function collapseSlashes(pathname: string): string {
	const protocolRegex = /\b[a-z][a-z\d+\-.]{1,50}:\/\//g;
	let lastIndex = 0;
	let result = "";
	for (;;) {
		const match = protocolRegex.exec(pathname);
		if (!match) break;
		const protocol = match[0];
		result += pathname.slice(lastIndex, match.index).replaceAll(/\/{2,}/g, "/");
		result += protocol;
		lastIndex = match.index + protocol.length;
	}
	return result + pathname.slice(lastIndex).replaceAll(/\/{2,}/g, "/");
}

/**
 * Normalise a URL to a form two equivalent addresses share.
 *
 * Named deviation: normalize-url throws on a URL it cannot parse. A validation
 * transform that throws turns a reportable failure into a crash, so rune hands
 * an unparseable value back untouched and lets `url()` report it.
 */
export function normalizeUrl(
	value: string,
	options: NormalizeUrlOptions = {},
): string {
	const o = { ...DEFAULTS, ...options };
	if (o.forceHttp && o.forceHttps) {
		throw new Error(
			"normalizeUrl(): forceHttp and forceHttps cannot be used together.",
		);
	}
	const defaultProtocol = o.defaultProtocol.endsWith(":")
		? o.defaultProtocol
		: `${o.defaultProtocol}:`;

	let urlString = value.trim();
	if (/^data:/i.test(urlString)) {
		try {
			return normalizeDataUrl(urlString, o.stripHash === true);
		} catch {
			return value;
		}
	}

	const allowedCustom = new Set(
		(o.customProtocols ?? [])
			.map(normalizeCustomProtocolOption)
			.filter((protocol): protocol is string => protocol !== undefined),
	);
	const customProtocol = getCustomProtocol(urlString);
	if (customProtocol && !allowedCustom.has(customProtocol)) return urlString;

	const hasRelativeProtocol = urlString.startsWith("//");
	const isRelativeUrl = !hasRelativeProtocol && /^\.*\//.test(urlString);
	if (!isRelativeUrl && !customProtocol) {
		urlString = urlString.replace(/^(?!(?:\w+:)?\/\/)|^\/\//, defaultProtocol);
	}

	let url: URL;
	try {
		url = new URL(urlString);
	} catch {
		return value;
	}

	if (o.forceProtocol) url.protocol = `${o.forceProtocol.replace(/:$/, "")}:`;
	if (o.forceHttp && url.protocol === "https:") url.protocol = "http:";
	if (o.forceHttps && url.protocol === "http:") url.protocol = "https:";

	if (o.stripAuthentication) {
		url.username = "";
		url.password = "";
	}

	if (o.stripHash) {
		url.hash = "";
	} else if (o.stripTextFragment) {
		url.hash = url.hash.replace(/#?:~:text.*?$/i, "");
	}

	if (url.pathname) {
		url.pathname = collapseSlashes(url.pathname);
		try {
			url.pathname = decodeURI(url.pathname).replaceAll("\\", "%5C");
		} catch {
			// Malformed escapes: leave the path as the URL parser wrote it.
		}
	}

	const directoryIndex =
		o.removeDirectoryIndex === true
			? [/^index\.[a-z]+$/]
			: Array.isArray(o.removeDirectoryIndex)
				? o.removeDirectoryIndex
				: undefined;
	if (directoryIndex && directoryIndex.length > 0) {
		const components = url.pathname.split("/").filter(Boolean);
		const last = components.at(-1);
		if (last && testParameter(last, directoryIndex)) {
			components.pop();
			url.pathname = components.length > 0 ? `/${components.join("/")}/` : "/";
		}
	}

	if (o.removePath) url.pathname = "/";
	if (typeof o.transformPath === "function") {
		const components = url.pathname.split("/").filter(Boolean);
		const next = o.transformPath(components);
		url.pathname = next && next.length > 0 ? `/${next.join("/")}` : "/";
	}

	if (url.hostname) {
		url.hostname = url.hostname.replace(/\.$/, "");
		// Each label is at most 63 characters, and a TLD at least 2 — so a host
		// that merely starts with "www." is not necessarily prefixed by one.
		if (
			o.stripWWW &&
			/^www\.(?!www\.)[a-z\-\d]{1,63}\.[a-z.\-\d]{2,63}$/.test(url.hostname)
		) {
			url.hostname = url.hostname.replace(/^www\./, "");
		}
	}

	const originalSearch = url.search;
	let tokenRegex: RegExp | undefined;
	if (o.sortQueryParameters && HAS_ENCODED_RESERVED.test(originalSearch)) {
		// Sorting round-trips the query through URLSearchParams, which decodes
		// reserved characters and changes what the URL means. Park them behind a
		// token first, and put them back after.
		const prefix = temporaryTokenPrefix(originalSearch);
		url.search = originalSearch.replaceAll(
			ENCODED_RESERVED_GLOBAL,
			(match) => `${prefix}${match.slice(1).toUpperCase()}`,
		);
		tokenRegex = new RegExp(`${prefix}([0-9A-F]{2})`, "g");
	}

	const keepList = Array.isArray(o.keepQueryParameters)
		? o.keepQueryParameters
		: undefined;
	const { searchParams } = url;

	if (!keepList && Array.isArray(o.removeQueryParameters)) {
		for (const key of [...searchParams.keys()]) {
			if (
				testParameter(
					decodeReservedTokens(key, tokenRegex),
					o.removeQueryParameters,
				)
			) {
				searchParams.delete(key);
			}
		}
	}
	if (!keepList && o.removeQueryParameters === true) url.search = "";

	if (keepList && keepList.length > 0) {
		for (const key of [...searchParams.keys()]) {
			if (!testParameter(decodeReservedTokens(key, tokenRegex), keepList)) {
				searchParams.delete(key);
			}
		}
	} else if (keepList) {
		url.search = "";
	}

	if (o.sortQueryParameters) {
		url.search = sortSearchParameters(url.searchParams, tokenRegex);
		// Serialising re-encodes; decode again, but double-encode the characters
		// that carry URL structure so decoding cannot change what the URL means.
		url.search = decodeURIComponent(
			url.search.replaceAll(/%(?:26|23|3f|25|2b)/gi, (m) => `%25${m.slice(1)}`),
		);
		if (tokenRegex) url.search = url.search.replace(tokenRegex, "%$1");
	}

	url.search = normalizeEmptyQueryParameters(
		url.search,
		o.emptyQueryValue,
		originalSearch,
	);

	if (o.removeTrailingSlash) url.pathname = url.pathname.replace(/\/$/, "");
	if (o.removeExplicitPort && url.port) url.port = "";

	const beforeSerialisation = urlString;
	urlString = url.toString();

	const removeSingleSlash = o.stripTrailingSlash ?? o.removeSingleSlash;
	if (
		!removeSingleSlash &&
		url.pathname === "/" &&
		!beforeSerialisation.endsWith("/") &&
		url.hash === ""
	) {
		urlString = urlString.replace(/\/$/, "");
	}
	if (
		(o.removeTrailingSlash || url.pathname === "/") &&
		url.hash === "" &&
		removeSingleSlash
	) {
		urlString = urlString.replace(/\/$/, "");
	}

	if (hasRelativeProtocol && !o.normalizeProtocol) {
		urlString = urlString.replace(/^http:\/\//, "//");
	}
	if (o.stripProtocol) urlString = urlString.replace(/^(?:https?:)?\/\//, "");
	return urlString;
}
