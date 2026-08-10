import { describe, expect, it } from "vitest";
import rune, {
	bindDatabase,
	compile,
	create,
	createRule,
	RuneError,
	RuneValidationError,
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

	it("tryValidate returns a tuple instead of throwing", async () => {
		const v = schema({ email: rules.string().email() });
		const [err, data] = await v.tryValidate({ email: "bad" });
		expect(data).toBeNull();
		expect(err?.messages[0]?.rule).toBe("email");

		const [err2, data2] = await v.tryValidate({ email: "a@b.io" });
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
		expect(v.validateResult({ cgu: "no" }).valid).toBe(false);
	});

	it("record() validates every value of an open-keyed object", () => {
		const v = schema({ counts: rules.record(rules.number().positive()) });
		expect(v.validateResult({ counts: { a: 1, b: 2 } }).valid).toBe(true);
		const bad = v.validateResult({ counts: { a: 1, b: -3 } });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]?.field).toBe("counts.b");
	});

	it("tuple() pins each position and rejects a wrong length", () => {
		const v = schema({ point: rules.tuple([rules.number(), rules.string()]) });
		expect(v.validateResult({ point: [1, "a"] }).valid).toBe(true);
		expect(v.validateResult({ point: ["a", 1] }).valid).toBe(false);
		// An extra item must not be silently ignored.
		expect(v.validateResult({ point: [1, "a", 99] }).valid).toBe(false);
	});

	it("union() passes on the first matching branch", () => {
		const v = schema({
			id: rules.union([rules.number(), rules.string().uuid()]),
		});
		expect(v.validateResult({ id: 42 }).valid).toBe(true);
		expect(
			v.validateResult({ id: "0191e2a0-0000-7000-8000-000000000000" }).valid,
		).toBe(true);
		const bad = v.validateResult({ id: "not-a-uuid" });
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
		const res = v.validateResult({});
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
		expect((await v.validateResultAsync({ email: "free@x.io" })).valid).toBe(
			true,
		);
		expect((await v.validateResultAsync({ email: "taken@x.io" })).valid).toBe(
			false,
		);
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
		await expect(
			v.validateResultAsync({ email: "a@b.io" }),
		).rejects.toBeInstanceOf(RuneError);
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
		expect(v.validateResult({ p: "X1234567" }).valid).toBe(true);
		expect(v.validateResult({ p: "12345" }).valid).toBe(false);
		expect(() => rules.string().passport({ countryCode: "ZZ" })).toThrow(
			RuneError,
		);
	});
});

describe("rune > date extras", () => {
	it("equals / afterOrSameAs / beforeOrSameAs", () => {
		expect(
			schema({ d: rules.date().equals("2026-06-25") }).validateResult({
				d: "2026-06-25",
			}).valid,
		).toBe(true);
		expect(
			schema({ d: rules.date().equals("2026-06-25") }).validateResult({
				d: "2026-06-26",
			}).valid,
		).toBe(false);

		const v = schema({ a: rules.date(), b: rules.date().afterOrSameAs("a") });
		expect(v.validateResult({ a: "2026-06-25", b: "2026-06-25" }).valid).toBe(
			true,
		);
		expect(v.validateResult({ a: "2026-06-25", b: "2026-06-24" }).valid).toBe(
			false,
		);
	});

	it("sameAs compares instants on a date chain, not references", () => {
		const v = schema({ a: rules.date(), b: rules.date().sameAs("a") });
		expect(v.validateResult({ a: "2026-06-25", b: "2026-06-25" }).valid).toBe(
			true,
		);
		expect(v.validateResult({ a: "2026-06-25", b: "2026-06-26" }).valid).toBe(
			false,
		);
	});
});

/**
 * `validate()` now IS the VineJS contract: async, returns the payload, throws.
 * The never-throwing forms rune also offers are named for what they do.
 */
describe("rune > validate() follows the VineJS contract", () => {
	it("resolves to the payload and throws on failure", async () => {
		const v = schema({ email: rules.string().email() });
		await expect(v.validate({ email: "a@b.io" })).resolves.toEqual({
			email: "a@b.io",
		});
		await expect(v.validate({ email: "bad" })).rejects.toBeInstanceOf(
			RuneValidationError,
		);
	});

	it("handles a schema with async rules without the caller opting in", async () => {
		const v = schema({ email: rules.string().unique(async () => false) });
		// The old sync entry point would have thrown "call validateAsync instead".
		await expect(v.validate({ email: "a@b.io" })).rejects.toBeInstanceOf(
			RuneValidationError,
		);
	});

	it("validateResult stays synchronous and never throws", () => {
		const v = schema({ email: rules.string().email() });
		const res = v.validateResult({ email: "bad" });
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.rule).toBe("email");
	});
});

describe("rune > union.if / union.else (VineJS parity)", () => {
	const shape = () =>
		rules.union([
			rules.union.if(
				(v) => typeof v === "object" && v !== null && "email" in v,
				rules.any().object({ email: rules.string().email() }),
			),
			rules.union.else(rules.any().object({ phone: rules.string().mobile() })),
		]);

	it("selects the guarded branch and reports ITS errors, not a bare 'union'", () => {
		const v = schema({ contact: shape() });
		expect(v.validateResult({ contact: { email: "a@b.io" } }).valid).toBe(true);

		const bad = v.validateResult({ contact: { email: "nope" } });
		expect(bad.valid).toBe(false);
		// The point of the guarded form: a diagnosable error.
		expect(bad.errors[0]?.rule).toBe("email");
		expect(bad.errors[0]?.field).toBe("contact.email");
	});

	it("falls back to union.else when no predicate matches", () => {
		const v = schema({ contact: shape() });
		expect(v.validateResult({ contact: { phone: "+41791234567" } }).valid).toBe(
			true,
		);
		const bad = v.validateResult({ contact: { phone: "nope" } });
		expect(bad.errors[0]?.rule).toBe("mobile");
	});

	it("keeps the bare-chain form working", () => {
		const v = schema({
			id: rules.union([rules.number(), rules.string().uuid()]),
		});
		expect(v.validateResult({ id: 42 }).valid).toBe(true);
		expect(v.validateResult({ id: "nope" }).errors[0]?.rule).toBe("union");
	});
});
