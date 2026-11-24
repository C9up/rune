/**
 * `decimal(n)` counts the decimal places of plain decimal notation only. A
 * number JavaScript prints with an exponent (`1e-7`) is refused, as it is
 * upstream, instead of counting as a whole number.
 */
import { describe, expect, it } from "vitest";
import rune from "../../src/index.js";

const order = rune.create({ amount: rune.number().positive().decimal(2) });

describe("rune > decimal() and exponent notation", () => {
	it("refuses a sub-cent amount whatever notation carries it", () => {
		for (const amount of [1e-7, "1e-7", "0.0000001", 5e-324, 1.5e-10, 0.001]) {
			const result = order.validateResult({ amount });
			expect(result.valid).toBe(false);
			expect(result.errors.map((error) => error.rule)).toEqual(["decimal"]);
		}
	});

	it("refuses a number too large to print in plain notation", () => {
		for (const amount of [1e21, "1e21", 1.23e21]) {
			expect(
				order.validateResult({ amount }).errors.map((error) => error.rule),
			).toEqual(["decimal"]);
		}
	});

	it("still takes plain amounts, written either way", () => {
		for (const amount of [1, 1.5, 19.99, "19.99", "1e2", 1e20, 0.01]) {
			expect(order.validateResult({ amount }).valid).toBe(true);
		}
		const signed = rune.create({ delta: rune.number().decimal(2) });
		expect(signed.validateResult({ delta: -0.25 }).valid).toBe(true);
		expect(signed.validateResult({ delta: -1e-7 }).valid).toBe(false);
	});

	it("keeps the [min, max] form", () => {
		const rate = rune.create({ rate: rune.number().decimal([2, 4]) });
		expect(rate.validateResult({ rate: 1.25 }).valid).toBe(true);
		expect(rate.validateResult({ rate: 1.2 }).valid).toBe(false);
		expect(rate.validateResult({ rate: 1e-7 }).valid).toBe(false);
	});
});
