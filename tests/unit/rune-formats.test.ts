import { describe, expect, it } from "vitest";
import { bindHostResolver, RuneError, rules, schema } from "../../src/index.js";

/** One valid / one invalid per rule — the invalid case is the one that matters. */
const ok = (chain: () => ReturnType<typeof rules.string>, value: unknown) =>
	schema({ v: chain() }).validateResult({ v: value }).valid;

describe("rune > format rules (VineJS parity)", () => {
	it("ulid / jwt / ascii / hexCode", () => {
		expect(ok(() => rules.string().ulid(), "01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(
			true,
		);
		expect(ok(() => rules.string().ulid(), "not-a-ulid")).toBe(false);
		// A ULID cannot start above 7 — the 26-char length alone would accept it.
		expect(ok(() => rules.string().ulid(), "81ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(
			false,
		);

		expect(ok(() => rules.string().jwt(), "aaa.bbb.ccc")).toBe(true);
		expect(ok(() => rules.string().jwt(), "aaa.bbb")).toBe(false);

		expect(ok(() => rules.string().ascii(), "plain")).toBe(true);
		expect(ok(() => rules.string().ascii(), "café")).toBe(false);

		expect(ok(() => rules.string().hexCode(), "#a3f")).toBe(true);
		expect(ok(() => rules.string().hexCode(), "#a3f0c1")).toBe(true);
		expect(ok(() => rules.string().hexCode(), "#xyz")).toBe(false);
	});

	it("ipAddress, with and without a pinned version", () => {
		expect(ok(() => rules.string().ipAddress(), "192.168.1.1")).toBe(true);
		expect(ok(() => rules.string().ipAddress(), "::1")).toBe(true);
		expect(ok(() => rules.string().ipAddress(), "2001:db8::ff00:42:8329")).toBe(
			true,
		);
		expect(ok(() => rules.string().ipAddress(), "256.1.1.1")).toBe(false);
		expect(ok(() => rules.string().ipAddress({ version: 4 }), "::1")).toBe(
			false,
		);
		expect(
			ok(() => rules.string().ipAddress({ version: 6 }), "192.168.1.1"),
		).toBe(false);
	});

	it("creditCard uses Luhn, not just length", () => {
		expect(ok(() => rules.string().creditCard(), "4242424242424242")).toBe(
			true,
		);
		expect(ok(() => rules.string().creditCard(), "4242 4242 4242 4242")).toBe(
			true,
		);
		// Same length, one digit off — a length check would pass this.
		expect(ok(() => rules.string().creditCard(), "4242424242424243")).toBe(
			false,
		);
	});

	it("iban uses the mod-97 checksum", () => {
		expect(ok(() => rules.string().iban(), "GB82 WEST 1234 5698 7654 32")).toBe(
			true,
		);
		expect(ok(() => rules.string().iban(), "GB82WEST12345698765433")).toBe(
			false,
		);
	});

	it("coordinates enforces the lat/lng ranges", () => {
		expect(ok(() => rules.string().coordinates(), "46.2044, 6.1432")).toBe(
			true,
		);
		expect(ok(() => rules.string().coordinates(), "91.0, 0.0")).toBe(false);
		expect(ok(() => rules.string().coordinates(), "46.2044")).toBe(false);
	});

	it("mobile accepts E.164", () => {
		expect(ok(() => rules.string().mobile(), "+41791234567")).toBe(true);
		expect(ok(() => rules.string().mobile(), "abc")).toBe(false);
	});

	it("postalCode checks per country and fails closed on an unknown one", () => {
		expect(
			ok(() => rules.string().postalCode({ countryCode: "CH" }), "1201"),
		).toBe(true);
		expect(
			ok(() => rules.string().postalCode({ countryCode: "CH" }), "12010"),
		).toBe(false);
		expect(
			ok(() => rules.string().postalCode({ countryCode: "US" }), "94105-1234"),
		).toBe(true);
		// An unsupported country must NOT silently accept everything.
		expect(() => rules.string().postalCode({ countryCode: "ZZ" })).toThrow(
			RuneError,
		);
	});

	it("notSameAs compares against a sibling", () => {
		const s = schema({
			oldPassword: rules.string(),
			newPassword: rules.string().notSameAs("oldPassword"),
		});
		expect(s.validateResult({ oldPassword: "a", newPassword: "b" }).valid).toBe(
			true,
		);
		const bad = s.validateResult({ oldPassword: "a", newPassword: "a" });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]?.rule).toBe("notSameAs");
	});

	it("distinct, plain and keyed by a field", () => {
		const plain = schema({ tags: rules.array(rules.string()).distinct() });
		expect(plain.validateResult({ tags: ["a", "b"] }).valid).toBe(true);
		expect(plain.validateResult({ tags: ["a", "a"] }).valid).toBe(false);

		const keyed = schema({
			users: rules
				.array(rules.any().object({ id: rules.number() }))
				.distinct("id"),
		});
		expect(keyed.validateResult({ users: [{ id: 1 }, { id: 2 }] }).valid).toBe(
			true,
		);
		expect(keyed.validateResult({ users: [{ id: 1 }, { id: 1 }] }).valid).toBe(
			false,
		);
	});

	it("withoutDecimals rejects a fractional number", () => {
		const s = schema({ n: rules.number().withoutDecimals() });
		expect(s.validateResult({ n: 42 }).valid).toBe(true);
		expect(s.validateResult({ n: 4.2 }).valid).toBe(false);
	});
});

describe("rune > format rule options (VineJS)", () => {
	it("alpha / alphaNumeric honour allowSpaces, underscores and dashes", () => {
		expect(ok(() => rules.string().alpha(), "abc def")).toBe(false);
		expect(
			ok(() => rules.string().alpha({ allowSpaces: true }), "abc def"),
		).toBe(true);
		expect(
			ok(() => rules.string().alphaNumeric({ allowUnderscores: true }), "a_1"),
		).toBe(true);
		expect(
			ok(() => rules.string().alphaNumeric({ allowDashes: true }), "a-1"),
		).toBe(true);
		// An option must not open the others.
		expect(
			ok(() => rules.string().alphaNumeric({ allowDashes: true }), "a_1"),
		).toBe(false);
	});

	it("url honours the validator.js-style options", () => {
		expect(
			ok(() => rules.string().url({ requireProtocol: false }), "example.com"),
		).toBe(true);
		expect(
			ok(() => rules.string().url({ requireProtocol: true }), "example.com"),
		).toBe(false);
		expect(
			ok(
				() => rules.string().url({ protocols: ["https"] }),
				"http://example.com",
			),
		).toBe(false);
		expect(
			ok(() => rules.string().url({ requireTld: false }), "http://localhost"),
		).toBe(true);
		expect(
			ok(() => rules.string().url({ requireTld: true }), "http://localhost"),
		).toBe(false);
	});

	it("mobile accepts a locale and fails closed on an unknown one", () => {
		expect(
			ok(() => rules.string().mobile({ locale: "fr-CH" }), "+41791234567"),
		).toBe(true);
		// Valid E.164, wrong country for the requested plan.
		expect(
			ok(() => rules.string().mobile({ locale: "fr-CH" }), "+33612345678"),
		).toBe(false);
		expect(
			ok(
				() => rules.string().mobile({ locale: ["fr-CH", "fr-FR"] }),
				"+33612345678",
			),
		).toBe(true);
		expect(() => rules.string().mobile({ locale: "xx-XX" })).toThrow(RuneError);
	});

	it("postalCode accepts several countries and a callback", () => {
		expect(
			ok(
				() => rules.string().postalCode({ countryCode: ["CH", "FR"] }),
				"75001",
			),
		).toBe(true);
		const s = schema({
			country: rules.string(),
			zip: rules
				.string()
				.postalCode((field) =>
					Array.isArray(field.parent) ? "CH" : String(field.parent.country),
				),
		});
		expect(s.validateResult({ country: "CH", zip: "1201" }).valid).toBe(true);
		expect(s.validateResult({ country: "CH", zip: "75001" }).valid).toBe(false);
	});
});

describe("rune > activeUrl", () => {
	it("routes through the bound host resolver", async () => {
		const seen: string[] = [];
		bindHostResolver({
			async resolves(host) {
				seen.push(host);
				return host === "example.com";
			},
		});
		const s = schema({ site: rules.string().url().activeUrl() });
		expect(
			(await s.validateResultAsync({ site: "https://example.com" })).valid,
		).toBe(true);
		const bad = await s.validateResultAsync({ site: "https://nope.invalid" });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]?.rule).toBe("activeUrl");
		expect(seen).toEqual(["example.com", "nope.invalid"]);
		bindHostResolver(null);
	});

	it("throws when no resolver is bound rather than passing an unchecked host", async () => {
		bindHostResolver(null);
		const s = schema({ site: rules.string().activeUrl() });
		await expect(
			s.validateResultAsync({ site: "https://example.com" }),
		).rejects.toBeInstanceOf(RuneError);
	});
});
