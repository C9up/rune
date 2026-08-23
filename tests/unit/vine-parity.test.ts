/**
 * VineJS surface a migrated validator calls: the union fallback, record key
 * checks, and enum choices — including the callback form, which is how a list
 * that depends on the request is computed per validation.
 */
import { describe, expect, it, vi } from "vitest";
import rune from "../../src/index.js";

describe("rune > union().otherwise()", () => {
	it("reports through the callback instead of the generic message", async () => {
		const schema = {
			id: rune
				.union([rune.string().minLength(3), rune.number()])
				.otherwise((_value, field) => {
					field.report("Give an id as text or a number", "id.shape", field);
				}),
		};
		const [error] = await rune.tryValidate({ schema, data: { id: true } });
		expect(error).not.toBeNull();
		expect(error?.messages[0]?.message).toBe("Give an id as text or a number");
	});

	it("still reports the generic message when no fallback is set", async () => {
		const schema = {
			id: rune.union([rune.string().minLength(3), rune.number()]),
		};
		const [error] = await rune.tryValidate({ schema, data: { id: true } });
		expect(error).not.toBeNull();
		expect(error?.messages[0]?.message).toMatch(/does not match/i);
	});

	it("does not run the fallback when a branch matched", async () => {
		const fallback = vi.fn();
		const schema = {
			id: rune.union([rune.string(), rune.number()]).otherwise(fallback),
		};
		const [error] = await rune.tryValidate({ schema, data: { id: 7 } });
		expect(error).toBeNull();
		expect(fallback).not.toHaveBeenCalled();
	});
});

describe("rune > record().validateKeys()", () => {
	it("sees every key at once and can reject the set", async () => {
		const schema = {
			prefs: rune.record(rune.string()).validateKeys((keys, field) => {
				if (keys.length > 2)
					field.report("At most two prefs", "prefs.max", field);
			}),
		};
		const [okError] = await rune.tryValidate({
			schema,
			data: { prefs: { a: "1", b: "2" } },
		});
		expect(okError).toBeNull();

		const [tooManyError] = await rune.tryValidate({
			schema,
			data: { prefs: { a: "1", b: "2", c: "3" } },
		});
		expect(tooManyError).not.toBeNull();
		expect(tooManyError?.messages[0]?.message).toBe("At most two prefs");
	});

	it("receives the keys in declaration order", async () => {
		const seen: string[][] = [];
		const schema = {
			prefs: rune.record(rune.string()).validateKeys((keys) => {
				seen.push(keys);
			}),
		};
		await rune.tryValidate({ schema, data: { prefs: { z: "1", a: "2" } } });
		expect(seen).toEqual([["z", "a"]]);
	});
});

describe("rune > enum choices", () => {
	it("reads back a static list", () => {
		expect(rune.enum(["draft", "published"]).getChoices()).toEqual([
			"draft",
			"published",
		]);
	});

	it("computes the list per validation when given a callback", async () => {
		const schema = {
			role: rune.enum((field) =>
				field.meta.admin === true
					? (["member", "owner"] as const)
					: (["member"] as const),
			),
		};
		const [adminError] = await rune.tryValidate({
			schema,
			data: { role: "owner" },
			meta: { admin: true },
		});
		expect(adminError).toBeNull();

		const [memberError] = await rune.tryValidate({
			schema,
			data: { role: "owner" },
			meta: { admin: false },
		});
		expect(memberError).not.toBeNull();
	});

	it("hands the callback itself back from getChoices", () => {
		const choices = () => ["a"] as const;
		expect(rune.enum(choices).getChoices()).toBe(choices);
	});
});

describe("rune > in() sees the field", () => {
	it("computes the allowed list from the request meta", async () => {
		const schema = {
			code: rune.string().in((field) => [String(field.meta.expected)]),
		};
		const [okError] = await rune.tryValidate({
			schema,
			data: { code: "xyz" },
			meta: { expected: "xyz" },
		});
		expect(okError).toBeNull();
		const [inBadError] = await rune.tryValidate({
			schema,
			data: { code: "xyz" },
			meta: { expected: "abc" },
		});
		expect(inBadError).not.toBeNull();
	});
});
