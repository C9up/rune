/**
 * Default messages, and who is allowed to change them.
 *
 * Every default lives in ONE catalogue keyed by the name a rule reports, and
 * that name is also the key a messages provider and a translator look up. Three
 * things follow, and each one was broken before:
 *
 *  - the text names the field it is about, so a flat error list reads;
 *  - a rule that upstream namespaces (`array.minLength`) reports the namespaced
 *    name, so a message written against it is actually found;
 *  - a `.use()` rule goes through the provider like any other, so a cross-field
 *    rule is translatable instead of permanently English.
 */

import { describe, expect, it } from "vitest";
import { messages as defaultMessages } from "../../src/defaults.js";
import { createRule, rules, schema } from "../../src/index.js";
import { SimpleMessagesProvider } from "../../src/MessagesProvider.js";

/** First error of a failing payload. */
function firstError(
	fields: Parameters<typeof schema>[0],
	data: Record<string, unknown>,
	options?: Parameters<ReturnType<typeof schema>["validateResult"]>[1],
) {
	const result = schema(fields).validateResult(data, options);
	expect(result.valid).toBe(false);
	return result.errors[0];
}

describe("rune > default messages", () => {
	it("names the field the error is about", () => {
		// The whole point of the catalogue: "Must be a string" told a user
		// nothing when six fields render their errors in one list.
		expect(firstError({ s: rules.string() }, {})?.message).toBe(
			"The s field must be defined",
		);
		expect(firstError({ s: rules.string() }, { s: 42 })?.message).toBe(
			"The s field must be a string",
		);
		expect(
			firstError({ s: rules.string().minLength(4) }, { s: "ab" })?.message,
		).toBe("The s field must have at least 4 characters");
	});

	it("names the LAST path segment, not the whole path", () => {
		const error = firstError(
			{ a: rules.object({ b: rules.string() }) },
			{ a: {} },
		);
		expect(error?.field).toBe("a.b");
		expect(error?.message).toBe("The b field must be defined");
	});

	it("counts items, not characters, on a container", () => {
		// The shared length rule used to render a string's wording for an
		// array: "must have at least 2 characters" about a list of items.
		expect(
			firstError(
				{ tags: rules.array(rules.string()).minLength(2) },
				{
					tags: ["a"],
				},
			)?.message,
		).toBe("The tags field must have at least 2 items");
	});

	it("renders the same text whichever engine ran", () => {
		// A simple schema goes to Rust, which carries its own copy of the
		// default text. Installing a provider is what forces the TypeScript
		// traversal, so these two are the two engines on one schema.
		const fields = { s: rules.string().minLength(4) };
		const viaNative = firstError(fields, { s: "ab" })?.message;
		const viaTypeScript = firstError(
			fields,
			{ s: "ab" },
			{
				messagesProvider: new SimpleMessagesProvider({}),
			},
		)?.message;
		expect(viaNative).toBe("The s field must have at least 4 characters");
		expect(viaTypeScript).toBe(viaNative);
	});

	it("does not let a rule's own argument overwrite the field name", () => {
		// `distinct` compares on a PROPERTY, and naming that argument `field`
		// made it win the `{{ field }}` token — the message then named the
		// property instead of the failing field.
		const error = firstError(
			{
				users: rules.array(rules.object({ id: rules.number() })).distinct("id"),
			},
			{ users: [{ id: 1 }, { id: 1 }] },
		);
		expect(error?.message).toBe("The users field has duplicate values");
	});
});

describe("rune > rule names are the message keys", () => {
	it("namespaces a rule by the type that owns it", () => {
		const cases: ReadonlyArray<
			[string, Parameters<typeof schema>[0], Record<string, unknown>]
		> = [
			[
				"array.minLength",
				{ f: rules.array(rules.string()).minLength(2) },
				{ f: [] },
			],
			[
				"record.maxLength",
				{ f: rules.record(rules.string()).maxLength(1) },
				{ f: { a: "a", b: "b" } },
			],
			[
				"date.after",
				{ f: rules.date().after("2030-01-01") },
				{ f: "2020-01-01" },
			],
			[
				"nativeFile.minSize",
				{ f: rules.nativeFile().minSize("1kb") },
				{ f: { size: 1, type: "text/plain" } },
			],
		];
		for (const [expected, fields, data] of cases) {
			expect(firstError(fields, data)?.rule).toBe(expected);
		}
	});

	it("leaves a rule upstream does NOT namespace alone", () => {
		// `notEmpty` and `distinct` stay bare on an array. Namespacing every
		// rule of a container would have been the easy mistake.
		expect(
			firstError({ f: rules.array(rules.string()).notEmpty() }, { f: [] })
				?.rule,
		).toBe("notEmpty");
	});

	it("finds a message written against the namespaced key", () => {
		const error = firstError(
			{ f: rules.array(rules.string()).minLength(2) },
			{ f: ["a"] },
			{
				messagesProvider: new SimpleMessagesProvider({
					"array.minLength": "Pick at least {{ min }}",
				}),
			},
		);
		expect(error?.message).toBe("Pick at least 2");
	});
});

describe("rune > a provider reaches every rule", () => {
	it("overrides a cross-field .use() rule", () => {
		// These rules carry their text inside `run` and reported it verbatim,
		// so no provider and no translation could ever reach them — while a
		// value rule on the very same chain honoured the provider.
		const error = firstError(
			{ a: rules.string().sameAs("b"), b: rules.string() },
			{ a: "x", b: "y" },
			{
				messagesProvider: new SimpleMessagesProvider({
					sameAs: "{{ field }} must equal {{ otherField }}",
				}),
			},
		);
		expect(error?.message).toBe("a must equal b");
	});

	it("overrides a rule a caller wrote", () => {
		const isEven = createRule((value: unknown, _options, field) => {
			if (typeof value === "number" && value % 2 !== 0) {
				field.report("Must be even", "isEven");
			}
		});
		const error = firstError(
			{ n: rules.number().use(isEven()) },
			{ n: 3 },
			{
				messagesProvider: new SimpleMessagesProvider({
					isEven: "{{ field }} has to be even",
				}),
			},
		);
		expect(error?.message).toBe("n has to be even");
	});

	it("keeps an explicit .message() above the provider", () => {
		const error = firstError(
			{ a: rules.string().sameAs("b").message("MINE"), b: rules.string() },
			{ a: "x", b: "y" },
			{
				messagesProvider: new SimpleMessagesProvider({ sameAs: "PROVIDER" }),
			},
		);
		expect(error?.message).toBe("MINE");
	});

	it("does not hand a caller's rule name a framework message", () => {
		// The catalogue is keyed by rule name, so an entry for a rule this
		// package does not ship would be claimed by a caller's rule of that
		// name — silently replacing their text with ours.
		const slug = createRule((value: unknown, _options, field) => {
			if (typeof value === "string" && value !== "ok") {
				field.report("Failed custom rule: slug", "slug");
			}
		});
		expect(
			firstError({ x: rules.string().use(slug()) }, { x: "no" })?.message,
		).toBe("Failed custom rule: slug");
	});
});

describe("rune > the catalogue is reachable", () => {
	it("keys every entry by a name some rule can report", () => {
		// An entry nothing reports is dead weight that reads like a promise:
		// upstream ships `record` and `tuple` keys its own runtime can never
		// select. Guard the two rune added on top.
		expect(defaultMessages.record).toBeDefined();
		expect(
			firstError({ f: rules.record(rules.string()) }, { f: 4 })?.rule,
		).toBe("record");
		expect(defaultMessages.tuple).toBeDefined();
		expect(
			firstError({ f: rules.tuple([rules.string()]) }, { f: 4 })?.rule,
		).toBe("tuple");
	});
});
