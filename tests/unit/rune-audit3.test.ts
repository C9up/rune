import { describe, expect, it } from "vitest";
import rune, {
	bindDatabase,
	compile,
	create,
	createAsyncRule,
	createRule,
	rules,
	SimpleMessagesProvider,
	schema,
} from "../../src/index.js";

/**
 * Regressions found by the third parity audit. All three are the same family as
 * the original nested-async bug: work that is silently NOT done reads exactly
 * like work that succeeded.
 */
describe("rune > audit 3 regressions", () => {
	it("awaits an async rule living inside the matching union branch", async () => {
		let checked = false;
		bindDatabase(null);
		const s = schema({
			id: rules.union([
				rules.number(),
				rules.string().unique(async () => {
					checked = true;
					return false;
				}),
			]),
		});
		const res = await s.validateResultAsync({ id: "abc" });
		expect(checked, "the branch's unique() must actually run").toBe(true);
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.rule).toBe("database.unique");
	});

	it("does not queue async work from a branch that lost", async () => {
		let losingRan = false;
		const s = schema({
			id: rules.union([
				rules.number(),
				rules.string().unique(async () => {
					losingRan = true;
					return false;
				}),
			]),
		});
		const res = await s.validateResultAsync({ id: 42 });
		expect(res.valid).toBe(true);
		expect(losingRan, "the string branch never matched").toBe(false);
	});

	it("runs an implicit ASYNC rule on an absent value", async () => {
		const seen: unknown[] = [];
		const mustBeProvided = createAsyncRule(
			async (value, _o, field) => {
				seen.push(value);
				if (value === undefined) field.report("Required", "asyncRequired");
			},
			{ implicit: true },
		);
		const s = schema({
			token: rules.any().optional().useAsync(mustBeProvided()),
		});
		const res = await s.validateResultAsync({});
		expect(seen).toEqual([undefined]);
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.rule).toBe("asyncRequired");
	});

	it("accepts a FieldContext as report()'s third argument, like VineJS", () => {
		const plugin = createRule((_v, _o, field) => {
			// A VineJS plugin passes the context itself, not a path string.
			field.report("Boom", "ported", field);
		});
		const s = schema({
			a: rules.any().object({ b: rules.any().use(plugin()) }),
		});
		const res = s.validateResult({ a: { b: 1 } });
		expect(res.errors[0]?.field).toBe("a.b");
		expect(typeof res.errors[0]?.field).toBe("string");
	});
});

describe("rune > number/boolean coercion (VineJS)", () => {
	it("coerces a numeric string and keeps the coerced value", () => {
		const s = schema({ age: rules.number().min(18) });
		const out = s.validateOrThrow({ age: "25" });
		expect(out.age).toBe(25);
		expect(typeof out.age).toBe("number");
		// Coercion is not laxity: a non-numeric string still fails.
		expect(s.validateResult({ age: "abc" }).valid).toBe(false);
		// …and the coerced value is what the other rules see.
		expect(s.validateResult({ age: "7" }).valid).toBe(false);
	});

	it("coerces the usual boolean spellings", () => {
		const s = schema({ ok: rules.boolean() });
		for (const [input, expected] of [
			["true", true],
			["on", true],
			["1", true],
			["false", false],
			["off", false],
			["0", false],
			[1, true],
			[0, false],
		] as const) {
			expect(s.validateOrThrow({ ok: input }).ok).toBe(expected);
		}
		expect(s.validateResult({ ok: "maybe" }).valid).toBe(false);
	});

	it("strict mode refuses coercion", () => {
		expect(
			schema({ n: rules.number({ strict: true }) }).validateResult({ n: "25" })
				.valid,
		).toBe(false);
		expect(
			schema({ b: rules.boolean({ strict: true }) }).validateResult({
				b: "true",
			}).valid,
		).toBe(false);
		expect(
			schema({ n: rules.number({ strict: true }) }).validateResult({ n: 25 })
				.valid,
		).toBe(true);
	});
});

describe("rune > object composition and the Vine entrypoint shapes", () => {
	const shape = () =>
		rules.any().object({
			id: rules.number(),
			name: rules.string(),
			secret: rules.string(),
		});

	it("pick / omit return spreadable properties, partial returns a schema", () => {
		const base = shape();
		// VineJS types these `Pick<Properties, Keys>` / `Omit<…>`: a properties
		// RECORD, so the idiomatic composition is a spread.
		const picked = base.pick(["id", "name"]);
		expect(Object.keys(picked)).toEqual(["id", "name"]);
		const composed = schema({ u: rules.any().object({ ...picked }) });
		expect(composed.validateResult({ u: { id: 1, name: "Ada" } }).valid).toBe(
			true,
		);

		// The source shape is untouched.
		expect(Object.keys(base.getProperties() ?? {})).toEqual([
			"id",
			"name",
			"secret",
		]);

		const omitted = base.omit(["secret"]);
		expect(Object.keys(omitted)).toEqual(["id", "name"]);

		const partial = schema({ user: shape().partial() });
		expect(partial.validateResult({ user: {} }).valid).toBe(true);
		expect(schema({ user: shape() }).validateResult({ user: {} }).valid).toBe(
			false,
		);
	});

	it("pick/omit/partial refuse a chain with no object shape", () => {
		expect(() => rules.string().pick(["a"])).toThrow(/object\(\) shape/);
	});

	it("create() and compile() accept rune.object(...) like vine does", () => {
		const v = create(rules.any().object({ n: rules.number() }));
		expect(v.validateOrThrow({ n: "7" })).toEqual({ n: 7 });
		const c = compile(rules.any().object({ n: rules.number() }));
		expect(c.validateOrThrow({ n: 7 })).toEqual({ n: 7 });
	});

	it("the default export offers the one-shot Vine helpers", async () => {
		expect(
			await rune.validate({ schema: { n: rune.number() }, data: { n: "12" } }),
		).toEqual({ n: 12 });
		const [err] = await rune.tryValidate({
			schema: { n: rune.number() },
			data: { n: "abc" },
		});
		expect(err?.messages[0]?.rule).toBe("number");
	});

	it("a global messages provider applies without a per-call option", () => {
		rune.messagesProvider = new SimpleMessagesProvider({
			number: "Doit être un nombre",
		});
		const res = schema({ n: rules.number() }).validateResult({ n: "abc" });
		expect(res.errors[0]?.message).toBe("Doit être un nombre");
		rune.messagesProvider = null;
	});
});
