import { describe, expect, it } from "vitest";
import rune, { createRule, RuneError, rules, schema } from "../../src/index.js";

describe("rune > audit 5", () => {
	it("nested objects DROP undeclared keys unless allowUnknownProperties()", () => {
		// The mass-assignment guarantee held at the top level but not one level
		// down: the nested walk spread the input, so an undeclared `isAdmin`
		// survived into the validated payload.
		const strict = schema({
			user: rules.any().object({ name: rules.string() }),
		});
		const out = strict.validateOrThrow({
			user: { name: "Ada", isAdmin: true },
		});
		expect(out.user).toEqual({ name: "Ada" });

		const lax = schema({
			user: rules
				.any()
				.object({ name: rules.string() })
				.allowUnknownProperties(),
		});
		expect(
			lax.validateOrThrow({ user: { name: "Ada", isAdmin: true } }).user,
		).toEqual({ name: "Ada", isAdmin: true });
	});

	it("file() reads Adonis size spellings and refuses an unreadable one", () => {
		const s = schema({ doc: rules.file({ size: "2mb" }) });
		expect(s.validateResult({ doc: { size: 1_000_000 } }).valid).toBe(true);
		expect(s.validateResult({ doc: { size: 3_000_000 } }).valid).toBe(false);
		expect(
			schema({ d: rules.file({ size: "512kb" }) }).validateResult({
				d: { size: 600_000 },
			}).valid,
		).toBe(false);
		// A cap that cannot be read must not silently become "no cap".
		expect(() => rules.file({ size: "2 bananas" })).toThrow(RuneError);
	});

	it("range takes the VineJS tuple", () => {
		const s = schema({ age: rules.number().range([18, 60]) });
		expect(s.validateResult({ age: 30 }).valid).toBe(true);
		expect(s.validateResult({ age: 17 }).valid).toBe(false);
		expect(s.validateResult({ age: 61 }).valid).toBe(false);
	});

	it("parse() receives the VineJS context", () => {
		let seen: Record<string, unknown> = {};
		const s = schema({
			currency: rules.string(),
			amount: rules.number().parse((value, ctx) => {
				seen = { parent: ctx.parent, meta: ctx.meta };
				return value;
			}),
		});
		s.validateResult(
			{ currency: "CHF", amount: 10 },
			{ meta: { tenantId: 4 } },
		);
		expect((seen.parent as Record<string, unknown>).currency).toBe("CHF");
		expect((seen.meta as Record<string, unknown>).tenantId).toBe(4);
	});

	it("array notEmpty / compact / composite distinct", () => {
		expect(
			schema({ t: rules.array(rules.string()).notEmpty() }).validateResult({
				t: [],
			}).valid,
		).toBe(false);

		const compacted = schema({ t: rules.array(rules.string()).compact() });
		expect(compacted.validateOrThrow({ t: ["a", null, "", "b"] }).t).toEqual([
			"a",
			"b",
		]);

		const composite = schema({
			rows: rules
				.array(rules.any().object({ a: rules.number(), b: rules.number() }))
				.distinct(["a", "b"]),
		});
		expect(
			composite.validateResult({
				rows: [
					{ a: 1, b: 1 },
					{ a: 1, b: 2 },
				],
			}).valid,
		).toBe(true);
		expect(
			composite.validateResult({
				rows: [
					{ a: 1, b: 1 },
					{ a: 1, b: 1 },
				],
			}).valid,
		).toBe(false);
	});

	it("union.otherwise mirrors union.else", () => {
		const v = schema({
			c: rules.union([
				rules.union.if((x) => typeof x === "number", rules.number().positive()),
				rules.union.otherwise(rules.string().email()),
			]),
		});
		expect(v.validateResult({ c: 5 }).valid).toBe(true);
		expect(v.validateResult({ c: "a@b.io" }).valid).toBe(true);
		expect(v.validateResult({ c: "nope" }).errors[0]?.rule).toBe("email");
	});

	it("errorReporter observes every error without changing the outcome", () => {
		const seen: string[] = [];
		const res = schema({
			a: rules.string(),
			b: rules.number(),
		}).validateResult(
			{ a: 1, b: "x" },
			{ errorReporter: (e) => seen.push(e.rule) },
		);
		expect(seen).toEqual(["string", "number"]);
		expect(res.valid).toBe(false);
	});

	it("createRule({ isAsync }) routes through use() to the awaited register", async () => {
		let ran = false;
		const slow = createRule(
			async (_v, _o, field) => {
				await Promise.resolve();
				ran = true;
				field.report("nope", "asyncViaUse");
			},
			{ isAsync: true },
		);
		const v = schema({ a: rules.string().use(slow()) });
		expect(() => v.validateResult({ a: "x" })).toThrow(/validateAsync|Async/);
		const res = await v.validateResultAsync({ a: "x" });
		expect(ran).toBe(true);
		expect(res.errors[0]?.rule).toBe("asyncViaUse");
	});

	it("unionOfTypes is exposed on the default export", () => {
		expect(typeof rune.unionOfTypes).toBe("function");
		expect(typeof rune.union.otherwise).toBe("function");
	});
});
