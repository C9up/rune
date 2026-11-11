/**
 * `min`/`max` on an array refused every array — the rule only knew a string's
 * length and a number's value — and a record's length rules refused every
 * record, which has no length but a key count.
 */
import { describe, expect, it } from "vitest";
import { rules, schema } from "../../src/index.js";

const check = (chain: Parameters<typeof schema>[0][string], value: unknown) =>
	schema({ v: chain }).validateResult({ v: value });

describe("rune > min and max size an array by its items", () => {
	it("bounds the item count, as minLength and maxLength do", () => {
		const chain = rules.array(rules.string()).min(1).max(2);
		expect(check(chain, ["a"]).valid).toBe(true);
		expect(check(chain, ["a", "b"]).valid).toBe(true);
		expect(check(chain, []).errors).toEqual([
			expect.objectContaining({ rule: "array.minLength", meta: { min: 1 } }),
		]);
		expect(check(chain, ["a", "b", "c"]).errors).toEqual([
			expect.objectContaining({ rule: "array.maxLength", meta: { max: 2 } }),
		]);
	});

	it("still counts a string's characters and compares a number's value", () => {
		expect(check(rules.string().min(2), "é").valid).toBe(false);
		expect(check(rules.string().min(2), "éé").valid).toBe(true);
		expect(check(rules.number().max(3), 3).valid).toBe(true);
		expect(check(rules.number().max(3), 4).valid).toBe(false);
	});
});

describe("rune > a record's length is its key count", () => {
	it("counts keys for minLength, maxLength and fixedLength", () => {
		const bounded = rules.record(rules.string()).minLength(1).maxLength(2);
		expect(check(bounded, { a: "x" }).valid).toBe(true);
		expect(check(bounded, {}).errors).toEqual([
			expect.objectContaining({ rule: "record.minLength" }),
		]);
		expect(check(bounded, { a: "x", b: "y", c: "z" }).errors).toEqual([
			expect.objectContaining({ rule: "record.maxLength" }),
		]);
		const fixed = rules.record(rules.string()).fixedLength(2);
		expect(check(fixed, { a: "x", b: "y" }).valid).toBe(true);
		expect(check(fixed, { a: "x" }).valid).toBe(false);
	});

	it("takes min and max as the same bounds", () => {
		const chain = rules.record(rules.number()).min(1).max(1);
		expect(check(chain, { a: 1 }).valid).toBe(true);
		expect(check(chain, { a: 1, b: 2 }).valid).toBe(false);
	});
});

describe("rune > string lengths count code points (named deviation)", () => {
	it("an emoji is one character to every length rule, on both engines", () => {
		const emoji = "😀";
		const viaEngine = schema({ s: rules.string().maxLength(1) });
		const viaTypeScript = schema({ s: rules.string().trim().maxLength(1) });
		for (const v of [viaEngine, viaTypeScript]) {
			expect(v.validateResult({ s: emoji }).valid).toBe(true);
			expect(v.validateResult({ s: `${emoji}${emoji}` }).valid).toBe(false);
		}
		expect(
			schema({ s: rules.string().fixedLength(2) }).validateResult({
				s: `a${emoji}`,
			}).valid,
		).toBe(true);
		expect(
			schema({ s: rules.string().min(2) }).validateResult({ s: emoji }).valid,
		).toBe(false);
	});

	it("the JSON Schema it emits counts the same way", () => {
		expect(
			schema({ s: rules.string().maxLength(1) }).toJSONSchema(),
		).toMatchObject({ properties: { s: { maxLength: 1 } } });
	});
});
