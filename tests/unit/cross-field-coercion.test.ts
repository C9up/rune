/**
 * `notSameAs()`, `sameAs()` and `confirmed()` compare the field after
 * coercion with a sibling read off the raw payload. On a `number()` or
 * `boolean()` chain the sibling is coerced the same way first, so equal
 * values are equal whatever type the client sent them in.
 */
import { describe, expect, it } from "vitest";
import rune from "../../src/index.js";

describe("rune > notSameAs() on a coercing chain", () => {
	const transfer = rune.create({
		from_account: rune.number(),
		to_account: rune.number().notSameAs("from_account"),
	});

	it.each([
		[7, 7],
		["7", 7],
		[7, "7"],
		["7", "7"],
		["7.0", " 7 "],
	])("refuses a transfer from %j to %j", (from_account, to_account) => {
		const result = transfer.validateResult({ from_account, to_account });
		expect(result.valid).toBe(false);
		expect(result.errors.map((error) => [error.field, error.rule])).toEqual([
			["to_account", "notSameAs"],
		]);
	});

	it("accepts two different accounts in any type", () => {
		for (const [from_account, to_account] of [
			[7, 8],
			["7", 8],
			["7", "8"],
		]) {
			expect(transfer.validateResult({ from_account, to_account })).toEqual({
				valid: true,
				errors: [],
				data: { from_account: 7, to_account: 8 },
			});
		}
	});

	it("a sibling that does not coerce compares as different", () => {
		const loose = rune.create({
			other: rune.any(),
			amount: rune.number().notSameAs("other"),
		});
		expect(loose.validateResult({ other: "seven", amount: 7 }).valid).toBe(
			true,
		);
	});
});

describe("rune > sameAs() and confirmed() on a coercing chain", () => {
	it("sameAs() matches equal numbers sent as strings", () => {
		const schema = rune.create({
			a: rune.number(),
			b: rune.number().sameAs("a"),
		});
		for (const payload of [
			{ a: "7", b: "7" },
			{ a: "7", b: 7 },
			{ a: 7, b: "7" },
		]) {
			expect(schema.validateResult(payload).valid).toBe(true);
		}
		expect(
			schema.validateResult({ a: "7", b: "8" }).errors.map((e) => e.rule),
		).toEqual(["sameAs"]);
		expect(schema.validateResult({ a: "seven", b: 7 }).valid).toBe(false);
	});

	it("confirmed() matches a confirmation sent as a string", () => {
		const schema = rune.create({ pin: rune.number().confirmed() });
		expect(
			schema.validateResult({ pin: "1234", pin_confirmation: "1234" }).valid,
		).toBe(true);
		expect(
			schema.validateResult({ pin: 1234, pin_confirmation: "1234" }).valid,
		).toBe(true);
		expect(
			schema
				.validateResult({ pin: "1234", pin_confirmation: "1235" })
				.errors.map((e) => e.rule),
		).toEqual(["confirmed"]);
	});

	it("a boolean chain reads the sibling's spelling too", () => {
		const schema = rune.create({
			a: rune.boolean(),
			b: rune.boolean().notSameAs("a"),
		});
		expect(schema.validateResult({ a: "on", b: true }).valid).toBe(false);
		expect(schema.validateResult({ a: "0", b: true }).valid).toBe(true);
	});

	it("a string chain still compares the strings as written", () => {
		const schema = rune.create({
			a: rune.string(),
			b: rune.string().notSameAs("a"),
		});
		expect(schema.validateResult({ a: "7", b: "7" }).valid).toBe(false);
		expect(schema.validateResult({ a: "07", b: "7" }).valid).toBe(true);
	});
});

describe("rune > distinct() on coerced items", () => {
	it("holds a number and its text spelling as one item", () => {
		const schema = rune.create({
			ids: rune.array(rune.number()).distinct(),
		});
		const result = schema.validateResult({ ids: ["7", 7] });
		expect(result.errors.map((error) => error.rule)).toEqual(["distinct"]);
		expect(schema.validateResult({ ids: ["7", 8, "9"] }).data).toEqual({
			ids: [7, 8, 9],
		});
	});

	it("keeps untyped items apart", () => {
		const schema = rune.create({ values: rune.array().distinct() });
		expect(schema.validateResult({ values: ["7", 7] }).valid).toBe(true);
		expect(schema.validateResult({ values: [7, 7] }).valid).toBe(false);
	});

	it("compares a property the same way", () => {
		const schema = rune.create({
			lines: rune
				.array(rune.object({ product_id: rune.number(), on: rune.boolean() }))
				.distinct("product_id"),
		});
		expect(
			schema
				.validateResult({
					lines: [
						{ product_id: "7", on: true },
						{ product_id: 7, on: false },
					],
				})
				.errors.map((error) => error.rule),
		).toEqual(["distinct"]);
		const composite = rune.create({
			lines: rune
				.array(rune.object({ product_id: rune.number(), on: rune.boolean() }))
				.distinct(["product_id", "on"]),
		});
		expect(
			composite.validateResult({
				lines: [
					{ product_id: "7", on: "true" },
					{ product_id: 7, on: true },
				],
			}).valid,
		).toBe(false);
		expect(
			composite.validateResult({
				lines: [
					{ product_id: "7", on: true },
					{ product_id: 7, on: false },
				],
			}).valid,
		).toBe(true);
	});
});
