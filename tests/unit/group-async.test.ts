/**
 * An async rule inside a conditional group must still be run.
 *
 * The sync entry points refuse a schema carrying async rules rather than
 * skipping them — that refusal is the only thing standing between a
 * `unique()` / `exists()` / `verifyContent()` and a value nobody checked. It
 * is driven by `hasAsyncRulesDeep`, which walks nested objects, array items,
 * record values, tuples and union branches. A conditional group contributes
 * its branch's fields to the shape at validation time exactly like those do.
 */

import { describe, expect, it } from "vitest";
import rune, { createAsyncRule, rules, schema } from "../../src/index.js";

/** Always reports — whatever reaches it must come back invalid. */
const alwaysRejects = createAsyncRule<undefined>((_value, _options, field) =>
	Promise.resolve().then(() => field.report("checked and refused", "probe")),
);

describe("rune > async rule inside a conditional group", () => {
	const grouped = () =>
		schema({
			p: rules
				.any()
				.object({ kind: rules.string() })
				.merge(
					rune.group([
						rune.group.if((data) => data.kind === "card", {
							token: rules.string().useAsync(alwaysRejects(undefined)),
						}),
						rune.group.else({ other: rules.string() }),
					]),
				),
		});

	it("is not silently skipped by the sync path", () => {
		// Either the rule runs, or the sync path refuses the schema. Quietly
		// returning `valid` is the one outcome that must not happen.
		expect(() =>
			grouped().validateResult({ p: { kind: "card", token: "anything" } }),
		).toThrow(/async/);
	});

	it("actually runs on the async path", async () => {
		const result = await grouped().validateResultAsync({
			p: { kind: "card", token: "anything" },
		});

		expect(result.valid).toBe(false);
	});
});
