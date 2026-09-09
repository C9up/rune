/**
 * The identifier formats — VAT, IBAN, passports, postal codes, mobiles.
 *
 * These are the rules that decide whether a real customer can finish a form.
 * A regex that is one character too strict rejects a valid Belgian VAT number
 * and nobody finds out from a unit test; the anchors below are published,
 * real-world numbers, so the checksums are checked against the outside world
 * rather than against themselves.
 */
import { describe, expect, it } from "vitest";
import {
	alphaPattern,
	escapeHtml,
	isAscii,
	isCoordinates,
	isCreditCard,
	isHexCode,
	isIban,
	isIpAddress,
	isJwt,
	isMobileForLocale,
	isPassport,
	isPostalCode,
	isUlid,
	isUrlWithOptions,
	isVat,
	normalizeEmail,
	normalizeUrl,
	SUPPORTED_MOBILE_LOCALES,
	SUPPORTED_PASSPORTS,
	SUPPORTED_POSTAL_CODES,
	SUPPORTED_VAT_COUNTRIES,
	toCamelCase,
} from "../../src/formats.js";

describe("rune > VAT numbers", () => {
	// Published registration numbers, one per checksum algorithm in the table.
	const real: Array<[string, string]> = [
		["DE", "DE136695976"],
		["DE", "DE811907980"],
		["NL", "NL123456782B12"],
		["IT", "IT00743110157"],
		["PT", "PT501442600"],
		["BE", "BE0776091951"],
		["LU", "LU26375245"],
		["CH", "CHE116281710"],
		["FR", "FR40303265045"],
		["GB", "GB123456789"],
	];

	for (const [country, number] of real) {
		it(`accepts a real ${country} number`, () => {
			expect(isVat(number, country)).toBe(true);
		});
	}

	it("reads a number the way a human writes it — spaces, dots, dashes, lower case", () => {
		expect(isVat("che-116.281.710 mwst", "CH")).toBe(true);
		expect(isVat("de 136 695 976", "de")).toBe(true);
	});

	it("rejects a number whose checksum does not hold", () => {
		// The digits are plausible and the format is right — only the checksum
		// says no, which is the entire point of having one.
		expect(isVat("DE136695975", "DE")).toBe(false);
		expect(isVat("NL123456783B12", "NL")).toBe(false);
		expect(isVat("IT00743110158", "IT")).toBe(false);
		expect(isVat("BE0776091952", "BE")).toBe(false);
		expect(isVat("LU26375246", "LU")).toBe(false);
		expect(isVat("CHE116281711", "CH")).toBe(false);
	});

	it("rejects a number of the wrong shape for its country", () => {
		expect(isVat("FR40303265045", "DE")).toBe(false);
		expect(isVat("DE12345", "DE")).toBe(false);
	});

	it("answers null for a country it has no rule for, rather than guessing", () => {
		// null is not false: the caller has to decide, and can fail loudly
		// instead of rejecting a valid number from an unlisted country.
		expect(isVat("XX123456789", "XX")).toBeNull();
		expect(isVat("US123456789", "US")).toBeNull();
	});

	it("lists the countries it can actually check", () => {
		expect(SUPPORTED_VAT_COUNTRIES).toContain("FR");
		expect(SUPPORTED_VAT_COUNTRIES).toContain("CH");
		expect(SUPPORTED_VAT_COUNTRIES).not.toContain("US");
	});
});

describe("rune > IBAN", () => {
	it("accepts published IBANs from several countries", () => {
		for (const iban of [
			"FR7630006000011234567890189",
			"GB82WEST12345698765432",
			"DE89370400440532013000",
			"CH9300762011623852957",
		]) {
			expect(isIban(iban)).toBe(true);
		}
	});

	it("reads an IBAN written in the printed, spaced form", () => {
		expect(isIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
	});

	it("rejects one whose check digits do not hold", () => {
		expect(isIban("GB82WEST12345698765433")).toBe(false);
	});

	it("rejects one that is not shaped like an IBAN at all", () => {
		expect(isIban("")).toBe(false);
		expect(isIban("1234567890")).toBe(false);
		expect(isIban("GB")).toBe(false);
	});
});

describe("rune > passports and postal codes", () => {
	it("accepts a passport number for a country it knows", () => {
		expect(isPassport("12AB34567", "FR")).toBe(true);
		expect(isPassport("123456789", "US")).toBe(true);
	});

	it("answers null for a country it has no pattern for", () => {
		expect(isPassport("123", "XX")).toBeNull();
		expect(SUPPORTED_PASSPORTS).toContain("FR");
	});

	it("accepts a postal code for a country it knows, in either case", () => {
		expect(isPostalCode("75001", "FR")).toBe(true);
		expect(isPostalCode("12345-6789", "US")).toBe(true);
		expect(isPostalCode("SW1A 1AA", "GB")).toBe(true);
		expect(isPostalCode("sw1a 1aa", "gb")).toBe(true);
	});

	it("rejects a postal code of the wrong shape", () => {
		expect(isPostalCode("7500", "FR")).toBe(false);
		expect(isPostalCode("ABCDE", "US")).toBe(false);
	});

	it("answers null for a country it has no pattern for", () => {
		expect(isPostalCode("1", "XX")).toBeNull();
		expect(SUPPORTED_POSTAL_CODES).toContain("FR");
	});
});

describe("rune > mobile numbers", () => {
	it("accepts a number in international and in national form", () => {
		expect(isMobileForLocale("+33612345678", "fr-FR")).toBe(true);
		expect(isMobileForLocale("0612345678", "fr-FR")).toBe(true);
		expect(isMobileForLocale("+12125551234", "en-US")).toBe(true);
	});

	it("rejects a landline where the locale distinguishes one", () => {
		expect(isMobileForLocale("0112345678", "fr-FR")).toBe(false);
	});

	it("answers null for a locale it has no pattern for", () => {
		expect(isMobileForLocale("123", "xx-XX")).toBeNull();
		expect(SUPPORTED_MOBILE_LOCALES).toContain("fr-FR");
	});
});

describe("rune > card numbers and coordinates", () => {
	it("accepts test card numbers from the major networks", () => {
		for (const card of [
			"4242424242424242",
			"5555555555554444",
			"378282246310005",
		]) {
			expect(isCreditCard(card)).toBe(true);
		}
	});

	it("reads a card number written in groups", () => {
		expect(isCreditCard("4242 4242 4242 4242")).toBe(true);
		expect(isCreditCard("4242-4242-4242-4242")).toBe(true);
	});

	it("rejects a number that fails Luhn — a mistyped digit", () => {
		expect(isCreditCard("4242424242424243")).toBe(false);
	});

	it("accepts a lat,long pair inside the real range", () => {
		expect(isCoordinates("48.8566, 2.3522")).toBe(true);
		expect(isCoordinates("-90,-180")).toBe(true);
	});

	it("rejects a pair outside it", () => {
		// 91° north is not a place.
		expect(isCoordinates("91,0")).toBe(false);
		expect(isCoordinates("0,181")).toBe(false);
		expect(isCoordinates("not, coordinates")).toBe(false);
	});
});

describe("rune > the small format checks", () => {
	it("tells ASCII from anything else", () => {
		expect(isAscii("plain text")).toBe(true);
		expect(isAscii("café")).toBe(false);
	});

	it("reads a hex colour in both lengths", () => {
		expect(isHexCode("#fff")).toBe(true);
		expect(isHexCode("#ffffff")).toBe(true);
		// The hash is optional, as it is in the rule this mirrors.
		expect(isHexCode("fff")).toBe(true);
		expect(isHexCode("#gggggg")).toBe(false);
	});

	it("reads a ULID", () => {
		expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
		expect(isUlid("not-a-ulid")).toBe(false);
	});

	it("reads a JWT by its three parts", () => {
		expect(isJwt("aaa.bbb.ccc")).toBe(true);
		expect(isJwt("aaa.bbb")).toBe(false);
	});

	it("tells an IPv4 from an IPv6, and can be pinned to one", () => {
		expect(isIpAddress("192.168.0.1")).toBe(true);
		expect(isIpAddress("::1")).toBe(true);
		expect(isIpAddress("192.168.0.1", 4)).toBe(true);
		expect(isIpAddress("192.168.0.1", 6)).toBe(false);
		expect(isIpAddress("::1", 6)).toBe(true);
		expect(isIpAddress("999.0.0.1")).toBe(false);
	});
});

describe("rune > escaping and normalisation", () => {
	it("escapes every character that could close a tag or an attribute", () => {
		expect(escapeHtml(`<script>alert("x")&'</script>`)).toBe(
			"&lt;script&gt;alert(&quot;x&quot;)&amp;&#x27;&lt;&#x2F;script&gt;",
		);
	});

	it("escapes the three that a bare tag-and-quote pass leaves behind", () => {
		// A backslash, a backtick and a slash all break out of contexts a
		// quote-only escape leaves standing — a template literal, an unquoted
		// attribute, a closing tag.
		expect(escapeHtml("a\\b`c/d")).toBe("a&#x5C;b&#96;c&#x2F;d");
	});

	it("leaves text with nothing to escape untouched", () => {
		expect(escapeHtml("plain text")).toBe("plain text");
	});

	it("lowercases the local part by default, and the domain always", () => {
		// A domain is case-insensitive by definition, so it is lowercased even
		// when the local part is left alone.
		expect(normalizeEmail("Ada@Acme.TEST")).toBe("ada@acme.test");
		expect(normalizeEmail("Ada@Acme.TEST", { allLowercase: false })).toBe(
			"Ada@acme.test",
		);
	});

	it("takes the validator.js spelling in preference to the alias", () => {
		// A transcribed Adonis validator arrives in snake_case; ignoring it
		// would silently apply the opposite of what was written.
		expect(
			normalizeEmail("Ada@Acme.TEST", {
				all_lowercase: false,
				allLowercase: true,
			}),
		).toBe("Ada@acme.test");
	});

	it("strips gmail dots and subaddresses BY DEFAULT, as upstream does", () => {
		// Normalising is what the caller asked for: the provider rules are on,
		// and an option is how you turn one off. rune had them opt-IN, which
		// meant `normalizeEmail()` returned an address Gmail does not use.
		expect(normalizeEmail("a.d.a+news@gmail.com")).toBe("ada@gmail.com");
		expect(
			normalizeEmail("a.d.a+news@gmail.com", {
				gmail_remove_dots: false,
				gmail_remove_subaddress: false,
			}),
		).toBe("a.d.a+news@gmail.com");
		// The camelCase aliases rune added still turn a rule off.
		expect(
			normalizeEmail("a.d.a+news@gmail.com", { gmailRemoveDots: false }),
		).toBe("a.d.a@gmail.com");
	});

	it("normalises the other providers validator.js knows", () => {
		// googlemail.com IS gmail.com.
		expect(normalizeEmail("A.B@googlemail.com")).toBe("ab@gmail.com");
		// Yahoo's subaddress separator is `-`, and only the LAST one counts.
		expect(normalizeEmail("Ada-Lovelace-news@yahoo.com")).toBe(
			"ada-lovelace@yahoo.com",
		);
		// Outlook and iCloud drop a `+tag` but keep their dots.
		expect(normalizeEmail("A.D.A+news@outlook.com")).toBe("a.d.a@outlook.com");
		expect(normalizeEmail("A.D.A+news@me.com")).toBe("a.d.a@me.com");
		// Every Yandex domain is yandex.ru.
		expect(normalizeEmail("Ada@ya.ru")).toBe("ada@yandex.ru");
	});

	it("keeps a doubled dot, which Gmail treats as a different mailbox", () => {
		expect(normalizeEmail("a..b@gmail.com")).toBe("a..b@gmail.com");
	});

	it("leaves the dots of a non-gmail address alone", () => {
		expect(normalizeEmail("a.d.a@acme.test", { gmailRemoveDots: true })).toBe(
			"a.d.a@acme.test",
		);
	});

	it("hands back an unparseable address rather than mangling it", () => {
		expect(normalizeEmail("not-an-address")).toBe("not-an-address");
	});

	it("normalises with upstream's defaults, not with everything switched off", () => {
		// rune shipped every option defaulting to OFF, so `normalizeUrl()` gave
		// back very nearly its input. normalize-url — which is what upstream calls —
		// strips `www.`, drops utm_ parameters, sorts the query and removes the
		// trailing slash unless told otherwise.
		expect(normalizeUrl("https://www.acme.test/")).toBe("https://acme.test");
		expect(normalizeUrl("https://acme.test/?b=2&a=1")).toBe(
			"https://acme.test/?a=1&b=2",
		);
		expect(normalizeUrl("https://acme.test/?utm_source=x&id=1")).toBe(
			"https://acme.test/?id=1",
		);
		expect(normalizeUrl("https://user:pw@acme.test/")).toBe(
			"https://acme.test",
		);
		expect(normalizeUrl("https://acme.test/p#:~:text=hi")).toBe(
			"https://acme.test/p",
		);
		expect(normalizeUrl("https://acme.test/a///b")).toBe(
			"https://acme.test/a/b",
		);
		// A URL with no protocol gets the default one.
		expect(normalizeUrl("acme.test/path")).toBe("http://acme.test/path");
		// And a data URL is normalised on its media type.
		expect(normalizeUrl("data:text/plain;charset=US-ASCII,Hello")).toBe(
			"data:,Hello",
		);
	});

	it("normalises a URL through each option it offers", () => {
		expect(normalizeUrl("http://acme.test", { forceHttps: true })).toBe(
			"https://acme.test",
		);
		expect(normalizeUrl("https://www.acme.test/", { stripWWW: false })).toBe(
			"https://www.acme.test",
		);
		expect(normalizeUrl("https://acme.test/p#top", { stripHash: true })).toBe(
			"https://acme.test/p",
		);
		expect(
			normalizeUrl("https://acme.test:443/p", { removeExplicitPort: true }),
		).toBe("https://acme.test/p");
		expect(
			normalizeUrl("https://acme.test/docs/index.html", {
				removeDirectoryIndex: true,
			}),
		).toBe("https://acme.test/docs");
		expect(
			normalizeUrl("https://acme.test/?b=2&a=1", {
				sortQueryParameters: false,
			}),
		).toBe("https://acme.test/?b=2&a=1");
		expect(normalizeUrl("https://acme.test/", { stripProtocol: true })).toBe(
			"acme.test",
		);
		expect(
			normalizeUrl("https://acme.test/p/", { removeTrailingSlash: false }),
		).toBe("https://acme.test/p/");
	});

	it("removes query parameters by name and by pattern", () => {
		expect(
			normalizeUrl("https://acme.test/?utm_source=x&id=1&utm_medium=y", {
				removeQueryParameters: ["id", /^utm_/],
			}),
		).toBe("https://acme.test");
	});

	it("keepQueryParameters wins over removeQueryParameters", () => {
		expect(
			normalizeUrl("https://acme.test/?a=1&b=2&utm_source=x", {
				keepQueryParameters: ["a"],
			}),
		).toBe("https://acme.test/?a=1");
		// An empty keep list drops the query entirely.
		expect(
			normalizeUrl("https://acme.test/?a=1", { keepQueryParameters: [] }),
		).toBe("https://acme.test");
	});

	it("hands back an unparseable URL untouched, for url() to report", () => {
		expect(normalizeUrl("not a url", { forceHttps: true })).toBe("not a url");
	});

	it("turns dashes, underscores and spaces into camelCase", () => {
		expect(toCamelCase("first-name")).toBe("firstName");
		expect(toCamelCase("first_name")).toBe("firstName");
		expect(toCamelCase("  first name  ")).toBe("firstName");
		expect(toCamelCase("firstName")).toBe("firstName");
	});
});

describe("rune > the alpha character class", () => {
	it("is letters only by default", () => {
		expect(alphaPattern("a-zA-Z").test("Ada")).toBe(true);
		expect(alphaPattern("a-zA-Z").test("Ada Lovelace")).toBe(false);
	});

	it("widens for each option it is given", () => {
		expect(
			alphaPattern("a-zA-Z", { allowSpaces: true }).test("Ada Lovelace"),
		).toBe(true);
		expect(
			alphaPattern("a-zA-Z", { allowUnderscores: true }).test("first_name"),
		).toBe(true);
		expect(
			alphaPattern("a-zA-Z", { allowDashes: true }).test("first-name"),
		).toBe(true);
	});
});

describe("rune > URLs with options", () => {
	it("requires a scheme by default", () => {
		expect(isUrlWithOptions("https://acme.test")).toBe(true);
		expect(isUrlWithOptions("acme.test")).toBe(false);
		expect(isUrlWithOptions("acme.test", { requireProtocol: false })).toBe(
			true,
		);
	});

	it("takes the snake_case spelling too", () => {
		expect(isUrlWithOptions("acme.test", { require_protocol: false })).toBe(
			true,
		);
	});

	it("accepts only the schemes it was given", () => {
		expect(isUrlWithOptions("acme.test", { protocols: ["https"] })).toBe(false);
		expect(isUrlWithOptions("https://acme.test", { protocols: ["ftp"] })).toBe(
			false,
		);
		// The default list is http/https/ftp, as the reference one is. It used
		// to stop at http/https, which made this helper disagree with
		// `helpers.isURL()` about the very same string.
		expect(isUrlWithOptions("ftp://acme.test")).toBe(true);
		// What the allow-list is actually for: the schemes that turn a link
		// into code stay out, listed or not.
		expect(isUrlWithOptions("javascript:alert(1)")).toBe(false);
		expect(isUrlWithOptions("data:text/html,<script>")).toBe(false);
		expect(isUrlWithOptions("mailto:a@acme.test")).toBe(false);
	});

	it("requires a dotted host unless told otherwise", () => {
		expect(isUrlWithOptions("https://localhost")).toBe(false);
		expect(isUrlWithOptions("https://localhost", { requireTld: false })).toBe(
			true,
		);
	});

	it("allows an underscore in the host only when asked", () => {
		expect(isUrlWithOptions("https://my_host.acme.test")).toBe(false);
		expect(
			isUrlWithOptions("https://my_host.acme.test", {
				allowUnderscores: true,
			}),
		).toBe(true);
	});

	it("rejects something that is not a URL at all", () => {
		expect(isUrlWithOptions("http://")).toBe(false);
	});
});

describe("rune > normalizeUrl: query strings and unusual schemes", () => {
	// Checked against the `normalize-url` package these paths were transcribed
	// from. Two answers differ from it on purpose and are marked below.

	it("leaves a scheme it was not told about completely alone", () => {
		// Normalising a URL whose scheme has no defined authority or path
		// semantics can only guess, so rune declines rather than guess.
		expect(normalizeUrl("myapp://Acme.Test/Path/")).toBe(
			"myapp://Acme.Test/Path/",
		);
		// Naming the scheme opts it in: now the trailing slash goes, and the
		// scheme itself survives.
		expect(
			normalizeUrl("myapp://Acme.Test/Path/", { customProtocols: ["myapp"] }),
		).toBe("myapp://Acme.Test/Path");
		expect(
			normalizeUrl("other://Acme.Test/Path/", { customProtocols: ["myapp"] }),
		).toBe("other://Acme.Test/Path/");
	});

	it("reads a custom scheme however it was spelled in the option", () => {
		expect(
			normalizeUrl("myapp://acme.test/x/", {
				customProtocols: ["  MYAPP:  ", "", "   "],
			}),
		).toBe("myapp://acme.test/x");
	});

	it("keeps a valueless query key valueless while sorting", () => {
		// `?flag` and `?flag=` are different requests to many servers, so a
		// round-trip through URLSearchParams must not turn one into the other.
		expect(normalizeUrl("https://acme.test/?flag&a=1&b")).toBe(
			"https://acme.test/?a=1&b&flag",
		);
		expect(normalizeUrl("https://acme.test/?flag")).toBe(
			"https://acme.test/?flag",
		);
	});

	it("keeps an encoded reserved character encoded through the sort", () => {
		// NAMED DEVIATION. Sorting round-trips the query through
		// URLSearchParams, which DECODES `%2F` to `/`; the reference package
		// lets that stand and answers `?a=/?`. A slash decoded inside a value
		// no longer means what it meant, so rune parks these behind a token and
		// restores them afterwards.
		expect(normalizeUrl("https://acme.test/?a=%2F%3F")).toBe(
			"https://acme.test/?a=%2F%3F",
		);
		expect(normalizeUrl("https://acme.test/?b=%2F&a=1")).toBe(
			"https://acme.test/?a=1&b=%2F",
		);
	});

	it("makes malformed percent-encoding well-formed", () => {
		// NAMED DEVIATION. `%zz` decodes to nothing; the reference hands it back
		// as it arrived, still malformed. rune escapes the stray `%`, so the
		// result is a URL that parses and round-trips.
		expect(normalizeUrl("https://acme.test/?a=%zz")).toBe(
			"https://acme.test/?a=%25zz",
		);
	});
});
