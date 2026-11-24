/**
 * `optional()`, `nullable()` and `nullish()` return a new chain and leave the
 * one they were called on unchanged, and a validator is fixed when it is
 * built: a chain shared by two validators keeps the rules each one declared.
 */
import { describe, expect, it } from "vitest";
import rune, { SimpleMessagesProvider } from "../../src/index.js";

/** Forces the TypeScript traversal, to compare it with the native engine. */
const viaTypeScript = { messagesProvider: new SimpleMessagesProvider({}) };

describe("rune > the presence modifiers return a new chain", () => {
	it("optional() does not relax a validator that shares the chain", async () => {
		const email = rune.string().email();
		const password = rune.string().minLength(12);

		const register = rune.create({ email, password });
		const update = rune.create({
			email: email.optional(),
			password: password.optional(),
		});

		const refused = register.validateResult({});
		expect(refused.valid).toBe(false);
		expect(refused.errors.map((error) => error.rule)).toEqual([
			"required",
			"required",
		]);
		await expect(register.validate({})).rejects.toMatchObject({
			code: "E_VALIDATION_ERROR",
		});
		expect(update.validateResult({})).toEqual({
			valid: true,
			errors: [],
			data: {},
		});
		// The derived chain kept the rules of the one it came from.
		expect(update.validateResult({ password: "short" }).valid).toBe(false);
	});

	it("holds whichever validator is built first", () => {
		const email = rune.string().email();
		const update = rune.create({ email: email.optional() });
		const register = rune.create({ email });
		expect(update.validateResult({}).valid).toBe(true);
		expect(register.validateResult({}).valid).toBe(false);
	});

	it("nullable() and nullish() leave their receiver required", () => {
		const owner = rune.number().positive();
		const transfer = rune.create({ owner_id: owner });
		const nullable = rune.create({ owner_id: owner.nullable() });
		const nullish = rune.create({ owner_id: owner.nullish() });

		expect(transfer.validateResult({ owner_id: null }).valid).toBe(false);
		expect(transfer.validateResult({}).valid).toBe(false);
		expect(nullable.validateResult({ owner_id: null })).toEqual({
			valid: true,
			errors: [],
			data: { owner_id: null },
		});
		expect(nullable.validateResult({}).valid).toBe(false);
		expect(nullish.validateResult({}).valid).toBe(true);
		expect(nullish.validateResult({ owner_id: null }).valid).toBe(true);
		// The rule of the shared chain is still enforced on each copy.
		expect(nullish.validateResult({ owner_id: -1 }).valid).toBe(false);
	});

	it("returns a distinct chain each time, with the flag only on the copy", () => {
		const name = rune.string();
		const optional = name.optional();
		const nullable = name.nullable();
		expect(optional).not.toBe(name);
		expect(nullable).not.toBe(name);
		expect(name.isOptionalField).toBe(false);
		expect(name.isNullable).toBe(false);
		expect(optional.isOptionalField).toBe(true);
		expect(optional.isNullable).toBe(false);
		expect(nullable.isNullable).toBe(true);
		expect(name.nullish().isOptionalField).toBe(true);
	});

	it("a rule method still adds to the chain it is called on", () => {
		const name = rune.string();
		expect(name.minLength(2)).toBe(name);
		expect(name.rules.map((rule) => rule.name)).toEqual([
			"string",
			"minLength",
		]);
	});

	it("message() after a modifier targets the copy's rule only", () => {
		const name = rune.string().minLength(3);
		const optional = name.optional().message("Too short for a nickname");
		const strict = rune.create({ name });
		const relaxed = rune.create({ name: optional });
		expect(relaxed.validateResult({ name: "ab" }).errors[0]?.message).toBe(
			"Too short for a nickname",
		);
		expect(strict.validateResult({ name: "ab" }).errors[0]?.message).not.toBe(
			"Too short for a nickname",
		);
	});
});

describe("rune > a validator is fixed when it is built", () => {
	it("a rule added to a shared chain later does not reach it", () => {
		const name = rune.string();
		const loose = rune.create({ name });
		const strict = rune.create({ name: name.maxLength(3) });
		for (const options of [undefined, viaTypeScript]) {
			expect(loose.validateResult({ name: "abcdef" }, options).valid).toBe(
				true,
			);
			expect(strict.validateResult({ name: "abcdef" }, options).valid).toBe(
				false,
			);
		}
	});

	it("a rule the engine does not run, added later, changes neither engine's answer", () => {
		const website = rune.string();
		const loose = rune.create({ website });
		website.url();
		for (const options of [undefined, viaTypeScript]) {
			expect(
				loose.validateResult({ website: "not a url" }, options).valid,
			).toBe(true);
		}
	});

	it("allowUnknownProperties() on a shared object does not open it", () => {
		const base = rune.object({ name: rune.string() });
		const strict = rune.create(base);
		const open = rune.create(base.allowUnknownProperties());
		const payload = { name: "ada", isAdmin: true };
		for (const options of [undefined, viaTypeScript]) {
			expect(strict.validateResult(payload, options).data).toEqual({
				name: "ada",
			});
			expect(open.validateResult(payload, options).data).toEqual(payload);
		}
	});

	it("covers the chains nested under it", () => {
		const tag = rune.string();
		const city = rune.string();
		const schema = rune.create({
			tags: rune.array(tag),
			address: rune.object({ city }),
			labels: rune.record(tag),
			pair: rune.tuple([tag, city]),
			id: rune.union([rune.union.if(() => true, tag)]),
		});
		const payload = {
			tags: ["abcdef"],
			address: { city: "Geneva" },
			labels: { a: "abcdef" },
			pair: ["abcdef", "Geneva"],
			id: "abcdef",
		};
		tag.maxLength(3);
		city.maxLength(3);
		expect(schema.validateResult(payload)).toEqual({
			valid: true,
			errors: [],
			data: payload,
		});
	});

	it("covers the branches of a group, and its otherwise() callback", () => {
		const account = rune.string();
		const payment = rune.group([
			rune.group.if((data) => data.type === "stripe", { account }),
		]);
		const schema = rune.create(
			rune.object({ type: rune.string() }).merge(payment),
		);
		account.maxLength(3);
		payment.otherwise(() => {});
		expect(
			schema.validateResult({ type: "stripe", account: "acct_123" }).valid,
		).toBe(true);
		expect(schema.validateResult({ type: "none" }).valid).toBe(false);
	});

	it("keeps one chain used for two fields working", () => {
		const name = rune.string().minLength(2);
		const schema = rune.create({ first: name, last: name });
		expect(
			schema.validateResult({ first: "ab", last: "c" }).errors,
		).toHaveLength(1);
	});

	it("still exposes the chain it was built from", () => {
		const base = rune.object({ name: rune.string() });
		const validator = rune.create(base);
		expect(validator.schema).toBe(base);
	});
});
