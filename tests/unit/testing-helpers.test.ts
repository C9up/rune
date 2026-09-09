/**
 * The `/testing` subpath: running a custom rule without building a schema.
 *
 * Before it there was no supported way to unit-test a `createRule` — you either
 * wrapped it in a whole schema, or hand-rolled a FieldContext and tested the
 * rule against a shape no real run ever produces.
 */
import { describe, expect, it } from "vitest";
import { createAsyncRule, createRule, RuneError } from "../../src/index.js";
import { fieldContext, runRule, runRuleAsync } from "../../src/testing.js";

const isEven = createRule((value, _options: undefined, field) => {
	if (typeof value !== "number" || value % 2 !== 0) {
		field.report("Must be even", "isEven", field);
	}
});

describe("rune > testing helpers", () => {
	it("runs a rule and reports what it said", () => {
		expect(runRule(isEven(), 4)).toEqual({
			valid: true,
			errors: [],
			value: 4,
		});
		const failed = runRule(isEven(), 3);
		expect(failed.valid).toBe(false);
		expect(failed.errors[0]?.rule).toBe("isEven");
		expect(failed.errors[0]?.message).toBe("Must be even");
	});

	it("hands back the mutated value", () => {
		const double = createRule((value, _o: undefined, field) => {
			if (typeof value === "number") field.mutate(value * 2);
		});
		const result = runRule(double(), 21);
		expect(result.value).toBe(42);
		expect(result.valid).toBe(true);
	});

	it("builds the context a real run would produce", () => {
		let captured: { name: unknown; path: string; wildCardPath: string } | null =
			null;
		const probe = createRule((_v, _o: undefined, field) => {
			captured = {
				name: field.name,
				path: field.getFieldPath(),
				wildCardPath: field.wildCardPath,
			};
		});
		runRule(probe(), "x", { path: "tags.0", parent: ["x"] });
		expect(captured).toEqual({
			name: 0,
			path: "tags.0",
			wildCardPath: "tags.*",
		});
	});

	it("lets a rule read its siblings", () => {
		const matchesConfirmation = createRule((value, _o: undefined, field) => {
			if (value !== field.data.password) {
				field.report("Does not match", "confirmed", field);
			}
		});
		expect(
			runRule(matchesConfirmation(), "s3cret", {
				data: { password: "s3cret" },
			}).valid,
		).toBe(true);
		expect(
			runRule(matchesConfirmation(), "typo", { data: { password: "s3cret" } })
				.valid,
		).toBe(false);
	});

	it("refuses to run an async rule synchronously", () => {
		const slow = createAsyncRule(async (_v, _o: undefined, field) => {
			field.report("nope", "slow", field);
		});
		expect(() => runRule(slow(), "x")).toThrow(RuneError);
	});

	it("awaits an async rule", async () => {
		const slow = createAsyncRule(async (value, _o: undefined, field) => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			if (value !== "ok") field.report("nope", "slow", field);
		});
		expect((await runRuleAsync(slow(), "ok")).valid).toBe(true);
		expect((await runRuleAsync(slow(), "no")).errors[0]?.rule).toBe("slow");
	});

	it("exposes the context builder for a shape runRule cannot express", () => {
		const field = fieldContext("x", { path: "a.b", isValid: false });
		expect(field.isValid).toBe(false);
		expect(field.getFieldPath()).toBe("a.b");
		expect(field.name).toBe("b");
	});
});
