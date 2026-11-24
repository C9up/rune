/**
 * `url()` judges the scheme of the value as it is written, the way
 * validator.js's `isURL` does. A scheme with no `//` after it is still a
 * scheme, unless what follows is a port or plain credentials.
 */
import { describe, expect, it } from "vitest";
import rune from "../../src/index.js";

const isURL = rune.helpers.isURL;

/** Script URLs whose script ends in a literal holding `@host`. */
const scriptUrls = [
	"javascript:alert(document.domain);`@evil.example`",
	"javascript:alert(document.cookie);'@evil.example'",
	'javascript:eval(atob(`YWxlcnQoZG9jdW1lbnQuY29va2llKQ==`));"@evil.example"',
	"JaVaScRiPt:alert(document.domain);`@evil.example`",
	"vbscript:x;`@evil.example`",
	"javascript:alert(1)@evil.example",
	// Percent-escaped: the credential characters are all allowed ones.
	"javascript:%61%6c%65%72%74%28%31%29@evil.example",
];

describe("rune > url() reads the scheme of the value", () => {
	it("refuses a script URL whose script holds @host", async () => {
		const profile = rune.create({ website: rune.string().url() });
		for (const website of scriptUrls) {
			expect(isURL(website)).toBe(false);
			const result = profile.validateResult({ website });
			expect(result.valid).toBe(false);
			expect(result.errors.map((error) => error.rule)).toEqual(["url"]);
			const [error] = await profile.tryValidate({ website });
			expect(error?.messages[0]?.rule).toBe("url");
		}
	});

	it("refuses it with a narrowed scheme list and after normalizeUrl()", () => {
		const httpsOnly = rune.create({
			website: rune.string().url({ protocols: ["https"] }),
		});
		const normalized = rune.create({
			website: rune.string().normalizeUrl().url(),
		});
		const strict = rune.create({
			website: rune.string().url({ require_protocol: true }),
		});
		for (const website of scriptUrls) {
			expect(httpsOnly.validateResult({ website }).valid).toBe(false);
			expect(normalized.validateResult({ website }).valid).toBe(false);
			expect(strict.validateResult({ website }).valid).toBe(false);
		}
	});

	it("still reads a port and plain credentials as part of a scheme-less URL", () => {
		expect(isURL("example.com")).toBe(true);
		expect(isURL("example.com:8080/path")).toBe(true);
		expect(isURL("user:password@example.com")).toBe(true);
		expect(isURL("user@example.com/path")).toBe(true);
		// None of those carries a scheme.
		for (const value of [
			"example.com",
			"example.com:8080/path",
			"user:password@example.com",
		]) {
			expect(isURL(value, { require_protocol: true })).toBe(false);
		}
	});

	it("refuses any scheme outside the list, with or without //", () => {
		expect(isURL("myapp://example.com/x")).toBe(false);
		expect(isURL("myapp:example.com")).toBe(false);
		expect(isURL("data:text/html,x@example.com")).toBe(false);
		expect(isURL("myapp://example.com/x", { protocols: ["myapp"] })).toBe(true);
		// The explicit opt-out accepts every scheme.
		expect(
			isURL("myapp://example.com/x", { require_valid_protocol: false }),
		).toBe(true);
	});
});

describe("rune > url() authority", () => {
	it("checks the credentials", () => {
		expect(isURL("https://user:password@example.com/x")).toBe(true);
		expect(isURL("https://user:pass:word@example.com")).toBe(false);
		expect(isURL("https://@example.com")).toBe(false);
		expect(isURL("https://:@example.com")).toBe(false);
		expect(isURL("https://user@example.com", { disallow_auth: true })).toBe(
			false,
		);
	});

	it("checks the port", () => {
		expect(isURL("https://example.com:8443/x")).toBe(true);
		expect(isURL("https://example.com:0")).toBe(false);
		expect(isURL("https://example.com:65536")).toBe(false);
		expect(isURL("https://example.com:80a")).toBe(false);
		expect(isURL("https://example.com", { require_port: true })).toBe(false);
		expect(isURL("https://example.com:8443", { require_port: true })).toBe(
			true,
		);
	});

	it("takes an IP address as a host", () => {
		expect(isURL("http://127.0.0.1/x")).toBe(true);
		expect(isURL("http://[::1]:3000/x")).toBe(true);
		expect(isURL("http://[::1]")).toBe(true);
		expect(isURL("http://[not-an-address]")).toBe(false);
		expect(isURL("http://999.1.1.1")).toBe(false);
	});

	it("wants a domain with a TLD unless told otherwise", () => {
		expect(isURL("http://localhost:3000")).toBe(false);
		expect(isURL("http://localhost:3000", { require_tld: false })).toBe(true);
		expect(isURL("http://example.123")).toBe(false);
		expect(isURL("http://-example.com")).toBe(false);
		expect(isURL("https://example.com.")).toBe(false);
		expect(isURL("https://example.com.", { allow_trailing_dot: true })).toBe(
			true,
		);
		expect(isURL("https://my_host.example.com")).toBe(false);
		expect(
			isURL("https://my_host.example.com", { allow_underscores: true }),
		).toBe(true);
	});

	it("wants a host unless told otherwise", () => {
		expect(isURL("https://")).toBe(false);
		expect(isURL("https:///path")).toBe(false);
		expect(isURL("https:///path", { require_host: false })).toBe(true);
	});

	it("filters hosts with the two lists", () => {
		const allowed = { host_whitelist: ["example.com", /\.example\.org$/] };
		expect(isURL("https://example.com/x", allowed)).toBe(true);
		expect(isURL("https://api.example.org", allowed)).toBe(true);
		expect(isURL("https://evil.example", allowed)).toBe(false);
		const refused = { host_blacklist: ["evil.example", /^internal\./] };
		expect(isURL("https://evil.example", refused)).toBe(false);
		expect(isURL("https://internal.example.com", refused)).toBe(false);
		expect(isURL("https://example.com", refused)).toBe(true);
		expect(isURL("http://[::1]", { host_blacklist: ["::1"] })).toBe(false);
	});
});

describe("rune > url() options keep validator.js's defaults", () => {
	it("allows a query and a fragment by default", () => {
		expect(isURL("https://example.com/x?a=1&b=2#top")).toBe(true);
		expect(isURL("https://example.com/#top", { allow_fragments: false })).toBe(
			false,
		);
		expect(
			isURL("https://example.com/?a=1", { allow_query_components: false }),
		).toBe(false);
	});

	it("refuses a protocol-relative URL by default", () => {
		expect(isURL("//example.com")).toBe(false);
		expect(isURL("//example.com", { allow_protocol_relative_urls: true })).toBe(
			true,
		);
	});

	it("caps the length at 2084 characters by default", () => {
		const base = "https://example.com/";
		const atLimit = base + "a".repeat(2084 - base.length);
		expect(isURL(atLimit)).toBe(true);
		expect(isURL(`${atLimit}a`)).toBe(false);
		expect(isURL(`${atLimit}a`, { validate_length: false })).toBe(true);
		expect(
			isURL("https://example.com/abcdef", { max_allowed_length: 20 }),
		).toBe(false);
	});

	it("refuses an empty string, white space and angle brackets", () => {
		for (const value of [
			"",
			"https://exa mple.com",
			"https://example.com/<x>",
		]) {
			expect(isURL(value)).toBe(false);
		}
	});
});
