import { describe, expect, it } from "vitest";
import {
	createAsyncRule,
	RuneValidationError,
	rules,
	schema,
} from "../../src/index.js";

/**
 * Async validation (`validateAsync`) + DB-backed `unique`/`exists` rules
 * (Adonis Lucid parity). rune stays framework-agnostic: the rules take a check
 * callback that does the query (e.g. against atlas), so no DB dependency here.
 */
describe("rune > async validation", () => {
	it("unique() passes when the check resolves true, fails when false", async () => {
		const taken = new Set(["ada@x.io"]);
		const s = schema({
			email: rules
				.string()
				.email()
				.unique(async (value) => !taken.has(String(value))),
		});

		const ok = await s.validateAsync({ email: "new@x.io" });
		expect(ok.valid).toBe(true);
		expect(ok.data).toEqual({ email: "new@x.io" });

		const bad = await s.validateAsync({ email: "ada@x.io" });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]).toMatchObject({
			field: "email",
			rule: "database.unique",
		});
	});

	it("exists() fails when the row is absent", async () => {
		const ids = new Set([1, 2, 3]);
		const s = schema({
			userId: rules.number().exists(async (value) => ids.has(Number(value))),
		});
		expect((await s.validateAsync({ userId: 2 })).valid).toBe(true);
		const missing = await s.validateAsync({ userId: 99 });
		expect(missing.valid).toBe(false);
		expect(missing.errors[0]).toMatchObject({ rule: "database.exists" });
	});

	it("skips the async rule when the field already failed a sync rule (no wasted query)", async () => {
		let called = 0;
		const s = schema({
			email: rules
				.string()
				.email()
				.unique(async () => {
					called++;
					return true;
				}),
		});
		const res = await s.validateAsync({ email: "not-an-email" });
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.rule).toBe("email");
		expect(called).toBe(0); // the DB check never ran
	});

	it("useAsync() runs a custom async rule", async () => {
		const rule = createAsyncRule<number>((value, max, field) => {
			return Promise.resolve().then(() => {
				if (Number(value) > max) field.report(`too big (>${max})`, "maxAsync");
			});
		});
		const s = schema({ n: rules.number().useAsync(rule(10)) });
		expect((await s.validateAsync({ n: 5 })).valid).toBe(true);
		expect((await s.validateAsync({ n: 20 })).errors[0]?.rule).toBe("maxAsync");
	});

	it("sync validate() throws on a schema with async rules (no silent bypass)", () => {
		const s = schema({
			email: rules.string().unique(async () => true),
		});
		expect(() => s.validate({ email: "x@y.io" })).toThrow(/validateAsync/);
	});

	it("validateOrThrowAsync throws RuneValidationError on failure", async () => {
		const s = schema({
			email: rules.string().unique(async () => false),
		});
		await expect(
			s.validateOrThrowAsync({ email: "x@y.io" }),
		).rejects.toBeInstanceOf(RuneValidationError);
		const s2 = schema({ email: rules.string().unique(async () => true) });
		await expect(s2.validateOrThrowAsync({ email: "x@y.io" })).resolves.toEqual(
			{
				email: "x@y.io",
			},
		);
	});
});
