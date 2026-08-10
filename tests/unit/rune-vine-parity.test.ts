import { describe, expect, it } from "vitest";
import rune, {
	bindDatabase,
	compile,
	create,
	createRule,
	RuneError,
	rules,
	schema,
} from "../../src/index.js";

describe("rune > public API (VineJS shape)", () => {
	it("exposes a default export carrying types and validator factories", () => {
		expect(typeof rune.string).toBe("function");
		expect(typeof rune.date).toBe("function");
		expect(rune.create).toBe(create);
		expect(typeof rune.compile).toBe("function");
		const validator = rune.create({ name: rune.string() });
		expect(validator.validateOrThrow({ name: "Ada" })).toEqual({ name: "Ada" });
	});

	it("compile() is exported and returns a usable validator", () => {
		const v = compile(schema({ n: rules.number() }));
		expect(v.validateOrThrow({ n: 4 })).toEqual({ n: 4 });
	});

	it("tryValidate returns a tuple instead of throwing", () => {
		const v = schema({ email: rules.string().email() });
		const [err, data] = v.tryValidate({ email: "bad" });
		expect(data).toBeNull();
		expect(err?.messages[0]?.rule).toBe("email");

		const [err2, data2] = v.tryValidate({ email: "a@b.io" });
		expect(err2).toBeNull();
		expect(data2).toEqual({ email: "a@b.io" });
	});
});

describe("rune > optional vs nullable output (VineJS split)", () => {
	it("optional() accepts null but drops the key", () => {
		const v = schema({ bio: rules.string().optional() });
		expect(v.validateOrThrow({ bio: null })).toEqual({});
		expect(v.validateOrThrow({})).toEqual({});
	});

	it("nullable() keeps null in the output", () => {
		const v = schema({ bio: rules.string().nullable() });
		expect(v.validateOrThrow({ bio: null })).toEqual({ bio: null });
	});
});

describe("rune > new schema types", () => {
	it("accepted() takes checkbox truthies and normalises to true", () => {
		const v = schema({ cgu: rules.accepted() });
		for (const ok of [true, 1, "1", "on", "yes", "true"]) {
			expect(v.validateOrThrow({ cgu: ok }).cgu).toBe(true);
		}
		expect(v.validate({ cgu: "no" }).valid).toBe(false);
	});

	it("record() validates every value of an open-keyed object", () => {
		const v = schema({ counts: rules.record(rules.number().positive()) });
		expect(v.validate({ counts: { a: 1, b: 2 } }).valid).toBe(true);
		const bad = v.validate({ counts: { a: 1, b: -3 } });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]?.field).toBe("counts.b");
	});

	it("tuple() pins each position and rejects a wrong length", () => {
		const v = schema({ point: rules.tuple([rules.number(), rules.string()]) });
		expect(v.validate({ point: [1, "a"] }).valid).toBe(true);
		expect(v.validate({ point: ["a", 1] }).valid).toBe(false);
		// An extra item must not be silently ignored.
		expect(v.validate({ point: [1, "a", 99] }).valid).toBe(false);
	});

	it("union() passes on the first matching branch", () => {
		const v = schema({
			id: rules.union([rules.number(), rules.string().uuid()]),
		});
		expect(v.validate({ id: 42 }).valid).toBe(true);
		expect(
			v.validate({ id: "0191e2a0-0000-7000-8000-000000000000" }).valid,
		).toBe(true);
		const bad = v.validate({ id: "not-a-uuid" });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]?.rule).toBe("union");
	});
});

describe("rune > createRule implicit + FieldContext", () => {
	it("a non-implicit rule is skipped on an absent value, an implicit one is not", () => {
		const seen: string[] = [];
		const plain = createRule((v) => {
			seen.push(`plain:${String(v)}`);
		});
		const implicit = createRule(
			(v, _o, field) => {
				seen.push(`implicit:${String(v)}`);
				if (v === undefined) field.report("Required", "customRequired");
			},
			{ implicit: true },
		);
		const v = schema({
			a: rules.any().optional().use(plain()).use(implicit()),
		});
		const res = v.validate({});
		expect(seen).toEqual(["implicit:undefined"]);
		expect(res.errors[0]?.rule).toBe("customRequired");
	});

	it("exposes the VineJS field context and lets a rule mutate the value", () => {
		let captured: Record<string, unknown> = {};
		const spy = createRule((v, _o, field) => {
			captured = {
				name: field.name,
				path: field.getFieldPath(),
				wildCardPath: field.wildCardPath,
				isArrayMember: field.isArrayMember,
				isDefined: field.isDefined,
			};
			field.mutate(String(v).toUpperCase());
		});
		const v = schema({ tags: rules.array(rules.string().use(spy())) });
		const out = v.validateOrThrow({ tags: ["ab"] });
		expect(out.tags).toEqual(["AB"]);
		expect(captured.name).toBe("0");
		expect(captured.path).toBe("tags.0");
		expect(captured.wildCardPath).toBe("tags.*");
		expect(captured.isArrayMember).toBe(true);
		expect(captured.isDefined).toBe(true);
	});
});

describe("rune > unique/exists Lucid options form", () => {
	it("routes through the bound resolver", async () => {
		const seen: unknown[] = [];
		bindDatabase({
			async exists(q) {
				seen.push(q);
				return q.value === "taken@x.io";
			},
		});
		const v = schema({
			email: rules.string().unique({ table: "users", where: { tenant_id: 3 } }),
		});
		expect((await v.validateAsync({ email: "free@x.io" })).valid).toBe(true);
		expect((await v.validateAsync({ email: "taken@x.io" })).valid).toBe(false);
		expect(seen[0]).toMatchObject({
			table: "users",
			column: "email",
			where: { tenant_id: 3 },
		});
		bindDatabase(null);
	});

	it("fails loudly when no resolver is bound — never silently passes", async () => {
		bindDatabase(null);
		const v = schema({ email: rules.string().unique({ table: "users" }) });
		await expect(v.validateAsync({ email: "a@b.io" })).rejects.toBeInstanceOf(
			RuneError,
		);
	});
});

describe("rune > string mutations and extra formats", () => {
	it("applies the VineJS mutations", () => {
		expect(
			schema({ v: rules.string().toUpperCase() }).validateOrThrow({ v: "ab" })
				.v,
		).toBe("AB");
		expect(
			schema({ v: rules.string().toCamelCase() }).validateOrThrow({
				v: "hello-world_again",
			}).v,
		).toBe("helloWorldAgain");
		expect(
			schema({ v: rules.string().escape() }).validateOrThrow({
				v: '<a href="x">',
			}).v,
		).toBe("&lt;a href=&quot;x&quot;&gt;");
		expect(
			schema({
				v: rules.string().normalizeEmail({ gmailRemoveDots: true }),
			}).validateOrThrow({ v: "A.D.A@Gmail.com" }).v,
		).toBe("ada@gmail.com");
		expect(
			schema({
				v: rules.string().normalizeUrl({ stripWWW: true }),
			}).validateOrThrow({ v: "https://www.example.com/a" }).v,
		).toBe("https://example.com/a");
	});

	it("passport checks per country and fails closed on an unknown one", () => {
		const v = schema({ p: rules.string().passport({ countryCode: "CH" }) });
		expect(v.validate({ p: "X1234567" }).valid).toBe(true);
		expect(v.validate({ p: "12345" }).valid).toBe(false);
		expect(() => rules.string().passport({ countryCode: "ZZ" })).toThrow(
			RuneError,
		);
	});
});

describe("rune > date extras", () => {
	it("equals / afterOrSameAs / beforeOrSameAs", () => {
		expect(
			schema({ d: rules.date().equals("2026-06-25") }).validate({
				d: "2026-06-25",
			}).valid,
		).toBe(true);
		expect(
			schema({ d: rules.date().equals("2026-06-25") }).validate({
				d: "2026-06-26",
			}).valid,
		).toBe(false);

		const v = schema({ a: rules.date(), b: rules.date().afterOrSameAs("a") });
		expect(v.validate({ a: "2026-06-25", b: "2026-06-25" }).valid).toBe(true);
		expect(v.validate({ a: "2026-06-25", b: "2026-06-24" }).valid).toBe(false);
	});

	it("sameAs compares instants on a date chain, not references", () => {
		const v = schema({ a: rules.date(), b: rules.date().sameAs("a") });
		expect(v.validate({ a: "2026-06-25", b: "2026-06-25" }).valid).toBe(true);
		expect(v.validate({ a: "2026-06-25", b: "2026-06-26" }).valid).toBe(false);
	});
});
