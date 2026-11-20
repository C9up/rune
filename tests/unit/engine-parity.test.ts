/**
 * The two engines must answer the same question.
 *
 * A schema carrying nothing TypeScript-only is validated by the Rust engine;
 * add a messages provider, a translator or a custom rule and the very same
 * schema takes the TypeScript traversal instead. Which one runs is therefore
 * an implementation detail of the surrounding application — so any rule that
 * disagrees between them is a rule whose verdict depends on something the
 * schema never said.
 *
 * The engine's `match` ends in "unknown rule — skip", so a rule routed to Rust
 * without an arm there is not an error: it is silently not enforced. Nothing
 * but this test stands between that and a value nobody checked. `email` is
 * deliberately not routed (the TypeScript check is structural where Rust has
 * one regex), which is exactly the kind of decision this locks down.
 */

import { describe, expect, it } from "vitest";
import { type RuleChain, rules, schema } from "../../src/index.js";
import {
	type MessagesProviderContract,
	SimpleMessagesProvider,
} from "../../src/MessagesProvider.js";

/** Forces the TypeScript traversal without changing a single rule. */
// Installing ANY provider is what pushes a schema off the native path, and the
// message has to come back rendered — a default is a `{{ field }}` template
// now, so a provider that returned it verbatim would compare two strings that
// no application ever sees. An empty catalogue is the smallest REAL provider:
// it matches no key and falls through to interpolating the default.
const forceTypeScript: MessagesProviderContract = new SimpleMessagesProvider(
	{},
);

/** One rule, and a value it must refuse. */
const CASES: ReadonlyArray<
	[name: string, chain: RuleChain, rejected: unknown]
> = [
	["string", rules.string(), 42],
	["number", rules.number(), "abc"],
	["boolean", rules.boolean(), "yes"],
	["min", rules.number().min(10), 9],
	["max", rules.number().max(10), 11],
	["positive", rules.number().positive(), -1],
	["negative", rules.number().negative(), 1],
	["nonNegative", rules.number().nonNegative(), -1],
	["range", rules.number().range([1, 5]), 9],
	["minLength", rules.string().minLength(5), "abc"],
	["maxLength", rules.string().maxLength(3), "abcdef"],
	["fixedLength", rules.string().fixedLength(4), "abc"],
	["uuid", rules.string().uuid(), "not-a-uuid"],
	["alpha", rules.string().alpha(), "abc123"],
	["alphaNumeric", rules.string().alphaNumeric(), "abc-123"],
	["startsWith", rules.string().startsWith("ab"), "xyz"],
	["endsWith", rules.string().endsWith("yz"), "abc"],
	["in", rules.string().in(["a", "b"]), "c"],
	["notIn", rules.string().notIn(["a", "b"]), "a"],
	["enum", rules.string().enum(["a", "b"]), "c"],
];

/**
 * Coercion decides what the application receives, not just whether it passes —
 * so the two engines have to produce the same VALUE, not only the same verdict.
 */
const COERCIONS: ReadonlyArray<
	[name: string, chain: RuleChain, input: unknown]
> = [
	["a numeric string", rules.number(), "42"],
	["a padded numeric string", rules.number(), " 42 "],
	// JS `Number()` reads radix prefixes; Rust's f64 parser does not, and
	// this one came back refused natively while TypeScript coerced it to 16.
	["a hexadecimal string", rules.number(), "0x10"],
	["a binary string", rules.number(), "0b101"],
	["an octal string", rules.number(), "0o17"],
	// A sign in front of a radix prefix is not a number in JS either.
	["a signed hexadecimal string", rules.number(), "-0x10"],
	// `from_str_radix` takes a `+` after the prefix; `Number()` does not.
	["a sign after a hexadecimal prefix", rules.number(), "0x+10"],
	["a sign after a binary prefix", rules.number(), "0b+1"],
	["a sign after an octal prefix", rules.number(), "0o+7"],
	["a negative sign after a prefix", rules.number(), "0x-1"],
	["a bare prefix", rules.number(), "0x"],
	// JS trims U+FEFF; Rust's `trim()` does not. And Rust trims U+0085,
	// which is not JS white space.
	["a leading byte order mark", rules.number(), "\uFEFF12"],
	["a trailing byte order mark", rules.number(), "12\uFEFF"],
	["a leading next-line character", rules.number(), "\u008512"],
	["ideographic spaces", rules.number(), "\u300012\u3000"],
	// Wider than 128 bits: `u128` overflowed where JS reads a float.
	["a 160-bit hexadecimal string", rules.number(), `0x${"f".repeat(40)}`],
	["a 1100-bit binary string", rules.number(), `0b1${"0".repeat(1099)}`],
	["a hexadecimal string past f64", rules.number(), `0x${"f".repeat(300)}`],
	// Rounding: 2^53 + 1 ties to even, a set bit far below breaks the tie.
	["a 54-bit tie", rules.number(), "0x20000000000001"],
	[
		"a tie broken by a sticky bit",
		rules.number(),
		`0x20000000000001${"0".repeat(20)}1`,
	],
	["exponent notation", rules.number(), "1e3"],
	["an empty string", rules.number(), ""],
	["a non-finite spelling", rules.number(), "Infinity"],
	["the usual boolean spellings", rules.boolean(), "on"],
	["a boolean-ish number", rules.boolean(), 1],
	["a word that is not a boolean", rules.boolean(), "yes"],
];

describe("rune > native and TypeScript engines coerce alike", () => {
	for (const [name, chain, input] of COERCIONS) {
		it(`agrees on ${name}`, () => {
			const s = schema({ v: chain });
			const viaNative = s.validateResult({ v: input });
			const viaTypeScript = s.validateResult(
				{ v: input },
				{ messagesProvider: forceTypeScript },
			);

			expect(viaNative.valid).toBe(viaTypeScript.valid);
			expect(viaNative.data?.v).toEqual(viaTypeScript.data?.v);
		});
	}

	it("agrees with Number() on random radix strings of every width", () => {
		// Deterministic LCG: the inputs are reproducible from the seed.
		let seed = 0x2545f491;
		const next = () => {
			seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
			return seed;
		};
		const s = schema({ v: rules.number() });
		for (let i = 0; i < 300; i++) {
			const [prefix, alphabet] =
				i % 3 === 0
					? ["0x", "0123456789abcdefABCDEF"]
					: i % 3 === 1
						? ["0b", "01"]
						: ["0o", "01234567"];
			let body = "";
			const width = 1 + (next() % 120);
			for (let j = 0; j < width; j++) {
				body += alphabet[next() % alphabet.length];
			}
			const input = `${prefix}${body}`;
			const expected = Number(input);
			expect({ input, v: s.validateResult({ v: input }).data?.v }).toEqual({
				input,
				v: expected,
			});
		}
	});
});

describe("rune > native and TypeScript engines agree", () => {
	for (const [name, chain, rejected] of CASES) {
		it(`${name} refuses the same value on both paths`, () => {
			const s = schema({ v: chain });
			const viaNative = s.validateResult({ v: rejected });
			const viaTypeScript = s.validateResult(
				{ v: rejected },
				{ messagesProvider: forceTypeScript },
			);

			// Both must refuse. A `true` on the native side is the silent skip.
			expect({
				native: viaNative.valid,
				typescript: viaTypeScript.valid,
			}).toEqual({ native: false, typescript: false });
			// And say the same thing. Which engine ran is invisible to the app, so
			// a message that names its bound on one path and not the other means
			// the text a user reads depends on whether the app installed i18n.
			expect(viaNative.errors[0]?.message).toBe(
				viaTypeScript.errors[0]?.message,
			);
		});
	}
});

describe("rune > the engine only ever sees the declared fields", () => {
	/** `[[[…]]]`, nested well past the engine parser's 128 levels. */
	const deep = JSON.parse(`${"[".repeat(200)}${"]".repeat(200)}`);

	it("an undeclared key nested past the parser's limit is simply dropped", () => {
		const v = schema({ name: rules.string() });
		expect(v.validateResult({ name: "x", junk: deep })).toEqual({
			valid: true,
			errors: [],
			data: { name: "x" },
		});
		expect(v.validateOrThrow({ name: "x", junk: deep })).toEqual({ name: "x" });
		expect(v.tryValidateSync({ name: "x", junk: deep })).toEqual([
			null,
			{ name: "x" },
		]);
	});

	it("a declared value nested past the limit gets a verdict, not a parse error", () => {
		const v = schema({ name: rules.string() });
		expect(v.validateResult({ name: deep }).errors).toEqual([
			expect.objectContaining({ field: "name", rule: "string" }),
		]);
		const sized = schema({ list: rules.any().minLength(1) });
		expect(sized.validateResult({ list: deep }).valid).toBe(true);
	});
});
