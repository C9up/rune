/**
 * `transform()` runs at output: after every rule of its chain, on a payload
 * that is valid. The rules judge the value before it; the callback never
 * receives a value a rule refused.
 */
import { afterEach, describe, expect, it } from "vitest";
import rune from "../../src/index.js";

describe("rune > transform() runs after the rules", () => {
	it("a bound declared on the input is checked on the input", () => {
		const discount = rune.create({
			percent: rune
				.number()
				.max(100)
				.transform((value) =>
					typeof value === "number" ? value / 100 : value,
				),
		});
		const refused = discount.validateResult({ percent: 5000 });
		expect(refused.valid).toBe(false);
		expect(refused.errors.map((error) => error.rule)).toEqual(["max"]);
		expect(discount.validateResult({ percent: 50 })).toEqual({
			valid: true,
			errors: [],
			data: { percent: 0.5 },
		});

		const account = rune.create({
			password: rune
				.string()
				.maxLength(72)
				.transform((value) => `hashed:${String(value).length}`),
		});
		expect(account.validateResult({ password: "x".repeat(5000) }).valid).toBe(
			false,
		);
		expect(account.validateResult({ password: "x".repeat(12) })).toMatchObject({
			valid: true,
			data: { password: "hashed:12" },
		});
	});

	it("the callback never receives a value a rule refused", () => {
		const seen: unknown[] = [];
		const download = rune.create({
			name: rune
				.string()
				.regex(/^[a-z0-9-]+$/)
				.transform((value) => {
					seen.push(value);
					return value;
				}),
		});
		expect(download.validateResult({ name: "../../etc/passwd" }).valid).toBe(
			false,
		);
		expect(seen).toEqual([]);
		expect(download.validateResult({ name: "report-2026" }).valid).toBe(true);
		expect(seen).toEqual(["report-2026"]);
	});

	it("a use() rule refuses before the callback runs", () => {
		let calls = 0;
		const even = rune.createRule((value, _options, field) => {
			if (typeof value === "number" && value % 2 !== 0) {
				field.report("Must be even", "even");
			}
		});
		const schema = rune.create({
			count: rune
				.number()
				.use(even())
				.transform((value) => {
					calls++;
					return String(value);
				}),
		});
		expect(schema.validateResult({ count: 3 }).valid).toBe(false);
		expect(calls).toBe(0);
		expect(schema.validateResult({ count: 4 })).toMatchObject({
			valid: true,
			data: { count: "4" },
		});
		expect(calls).toBe(1);
	});

	it("a rule added after transform() still judges the value before it", () => {
		const schema = rune.create({
			code: rune
				.string()
				.transform((value) => `prefix-${String(value)}`)
				.maxLength(3),
		});
		expect(schema.validateResult({ code: "abc" })).toMatchObject({
			valid: true,
			data: { code: "prefix-abc" },
		});
		expect(schema.validateResult({ code: "abcd" }).valid).toBe(false);
	});

	it("the callback does not run when another field is refused", () => {
		let calls = 0;
		const schema = rune.create({
			name: rune.string().transform((value) => {
				calls++;
				return value;
			}),
			age: rune.number().min(18),
		});
		expect(schema.validateResult({ name: "ada", age: 3 }).valid).toBe(false);
		expect(calls).toBe(0);
	});

	it("several callbacks run in the order they were declared", () => {
		const schema = rune.create({
			tag: rune
				.string()
				.transform((value) => `${String(value)}-a`)
				.transform((value) => `${String(value)}-b`),
		});
		expect(schema.validateResult({ tag: "x" })).toMatchObject({
			data: { tag: "x-a-b" },
		});
	});
});

describe("rune > transform() and the async rules", () => {
	afterEach(() => rune.bindDatabase(null));

	it("an async rule sees the value before the callback, and gates it", async () => {
		const looked: unknown[] = [];
		let calls = 0;
		rune.bindDatabase({
			exists: async (query) => {
				looked.push(query.value);
				return query.value === 7;
			},
		});
		const schema = rune.create({
			owner: rune
				.number()
				.exists({ table: "users", column: "id" })
				.transform((value) => {
					calls++;
					return { id: value };
				}),
		});
		const refused = await schema.validateResultAsync({ owner: "8" });
		expect(refused.valid).toBe(false);
		expect(calls).toBe(0);
		expect(await schema.validate({ owner: "7" })).toEqual({ owner: { id: 7 } });
		expect(calls).toBe(1);
		// The lookups received the validated number, never the callback's object.
		expect(looked).toEqual([8, 7]);
	});
});

describe("rune > what runs before the rules", () => {
	it("the built-in mutators still do, and the callback gets their result", () => {
		const schema = rune.create({
			name: rune
				.string()
				.trim()
				.minLength(3)
				.transform((value) => String(value).toUpperCase()),
		});
		expect(schema.validateResult({ name: "  ab  " }).valid).toBe(false);
		expect(schema.validateResult({ name: "  abc  " })).toMatchObject({
			data: { name: "ABC" },
		});
	});

	it("parse() changes the raw input, and the rules judge what it returns", () => {
		const schema = rune.create({
			price: rune
				.number()
				.parse((value) =>
					typeof value === "string" ? value.replace(",", ".") : value,
				)
				.max(100),
		});
		expect(schema.validateResult({ price: "12,5" })).toMatchObject({
			valid: true,
			data: { price: 12.5 },
		});
		expect(schema.validateResult({ price: "120,5" }).valid).toBe(false);
	});
});

describe("rune > transform() at every depth", () => {
	it("is not called for null or for an absent value", () => {
		let calls = 0;
		const count = (value: unknown) => {
			calls++;
			return value;
		};
		const schema = rune.create({
			a: rune.string().nullable().transform(count),
			b: rune.string().optional().transform(count),
			c: rune.string().transform(count).nullable(),
		});
		expect(schema.validateResult({ a: null, c: null })).toEqual({
			valid: true,
			errors: [],
			data: { a: null, c: null },
		});
		expect(calls).toBe(0);
	});

	it("replaces a property, an item, a record value and a tuple position", () => {
		const upper = (value: unknown) => String(value).toUpperCase();
		const schema = rune.create({
			user: rune.object({ first_name: rune.string().transform(upper) }),
			camel: rune
				.object({ first_name: rune.string().transform(upper) })
				.toCamelCaseKeys(),
			tags: rune.array(rune.string().transform(upper)),
			labels: rune.record(rune.string().transform(upper)),
			pair: rune.tuple([rune.string().transform(upper), rune.number()]),
		});
		expect(
			schema.validateResult({
				user: { first_name: "ada" },
				camel: { first_name: "ada" },
				tags: ["a", "b"],
				labels: { x: "y" },
				pair: ["p", "2"],
			}),
		).toEqual({
			valid: true,
			errors: [],
			data: {
				user: { first_name: "ADA" },
				camel: { firstName: "ADA" },
				tags: ["A", "B"],
				labels: { x: "Y" },
				pair: ["P", 2],
			},
		});
	});

	it("a container's callback sees its children's final values", () => {
		const schema = rune.create({
			tags: rune
				.array(rune.string().transform((value) => String(value).toUpperCase()))
				.transform((value) => (Array.isArray(value) ? value.join(",") : value)),
		});
		expect(schema.validateResult({ tags: ["a", "b"] })).toMatchObject({
			data: { tags: "A,B" },
		});
	});

	it("replaces the output of the union branch that was chosen", () => {
		const guarded = rune.create({
			id: rune
				.union([
					rune.union.if(
						(value) => typeof value === "string",
						rune.string().transform((value) => `s:${String(value)}`),
					),
					rune.union.else(
						rune.number().transform((value) => `n:${String(value)}`),
					),
				])
				.transform((value) => `[${String(value)}]`),
		});
		expect(guarded.validateResult({ id: "a" }).data).toEqual({ id: "[s:a]" });
		expect(guarded.validateResult({ id: 4 }).data).toEqual({ id: "[n:4]" });

		let losing = 0;
		const bare = rune.create({
			id: rune.union([
				rune
					.string()
					.minLength(5)
					.transform(() => {
						losing++;
						return "long";
					}),
				rune.string().transform((value) => `short:${String(value)}`),
			]),
		});
		expect(bare.validateResult({ id: "ab" }).data).toEqual({ id: "short:ab" });
		// The branch that did not validate left no callback behind.
		expect(losing).toBe(0);
	});

	it("replaces the output of a root chain", async () => {
		const root = rune.create(
			rune.string().transform((value) => String(value).length),
		);
		expect(await root.validate("abcd")).toBe(4);
	});
});
