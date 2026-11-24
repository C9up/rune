/**
 * A payload whose every item fails gets a verdict, however many errors that
 * makes. The errors of a container are appended one by one: a spread call
 * throws `RangeError` past the engine's argument limit (about 125 000).
 *
 * This is the one test that needs a large input — the limit is what it is
 * about. Peak memory is about 150 MB.
 */
import { describe, expect, it } from "vitest";
import rune, { errors } from "../../src/index.js";

const ITEMS = 130_000;
const invalidTags = () => new Array<unknown>(ITEMS).fill(1);

describe("rune > an error list past the argument limit", () => {
	it("is a validation failure from every entry point", async () => {
		const schema = rune.create({ tags: rune.array(rune.string()) });
		const payload = { tags: invalidTags() };

		const result = schema.validateResult(payload);
		expect(result.valid).toBe(false);
		expect(result.errors).toHaveLength(ITEMS);
		expect(result.errors[ITEMS - 1]).toMatchObject({
			field: `tags.${ITEMS - 1}`,
			rule: "string",
			index: ITEMS - 1,
		});

		const [error, data] = await schema.tryValidate(payload);
		expect(data).toBeNull();
		expect(error).toBeInstanceOf(errors.E_VALIDATION_ERROR);
		expect(error?.messages).toHaveLength(ITEMS);

		const thrown = await schema.validate(payload).catch((e: unknown) => e);
		expect(thrown).toBeInstanceOf(errors.E_VALIDATION_ERROR);
		expect(() => schema.validateOrThrow(payload)).toThrow(
			errors.E_VALIDATION_ERROR,
		);
	}, 30_000);

	it("holds for a root array and for a union branch", () => {
		const root = rune.create(rune.array(rune.string()));
		expect(root.validateResult(invalidTags()).errors).toHaveLength(ITEMS);

		const guarded = rune.create({
			tags: rune.union([rune.union.if(() => true, rune.array(rune.string()))]),
		});
		expect(guarded.validateResult({ tags: invalidTags() }).errors).toHaveLength(
			ITEMS,
		);
	}, 30_000);
});
