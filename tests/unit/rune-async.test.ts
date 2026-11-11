import { describe, expect, it } from "vitest";
import {
	createAsyncRule,
	RuneValidationError,
	rules,
	schema,
} from "../../src/index.js";

/**
 * Async validation (`validateResultAsync` / `validate`) + DB-backed `unique`/`exists` rules
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

		const ok = await s.validateResultAsync({ email: "new@x.io" });
		expect(ok.valid).toBe(true);
		expect(ok.data).toEqual({ email: "new@x.io" });

		const bad = await s.validateResultAsync({ email: "ada@x.io" });
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
		expect((await s.validateResultAsync({ userId: 2 })).valid).toBe(true);
		const missing = await s.validateResultAsync({ userId: 99 });
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
		const res = await s.validateResultAsync({ email: "not-an-email" });
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
		expect((await s.validateResultAsync({ n: 5 })).valid).toBe(true);
		expect((await s.validateResultAsync({ n: 20 })).errors[0]?.rule).toBe(
			"maxAsync",
		);
	});

	it("sync validate() throws on a schema with async rules (no silent bypass)", () => {
		const s = schema({
			email: rules.string().unique(async () => true),
		});
		expect(() => s.validateResult({ email: "x@y.io" })).toThrow(
			/validateResultAsync/,
		);
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

/**
 * Async rules nested under an object or an array used to be invisible: the
 * schema-level detection only inspected top-level chains, so `validate()` did
 * not throw and the async pass never ran them. A `unique` check that never
 * runs reads exactly like a `unique` check that passed.
 */
describe("rune > async validation at depth", () => {
	it("sync validate() throws on an async rule nested in an object", () => {
		const s = schema({
			user: rules.any().object({
				email: rules.string().unique(async () => true),
			}),
		});
		expect(() => s.validateResult({ user: { email: "x@y.io" } })).toThrow(
			/validateResultAsync/,
		);
	});

	it("sync validate() throws on an async rule nested in an array item", () => {
		const s = schema({
			emails: rules.array(rules.string().unique(async () => true)),
		});
		expect(() => s.validateResult({ emails: ["x@y.io"] })).toThrow(
			/validateResultAsync/,
		);
	});

	it("validateResultAsync runs a unique() nested in an object", async () => {
		const taken = new Set(["ada@x.io"]);
		const s = schema({
			user: rules.any().object({
				email: rules
					.string()
					.email()
					.unique(async (value) => !taken.has(String(value))),
			}),
		});

		const ok = await s.validateResultAsync({ user: { email: "new@x.io" } });
		expect(ok.valid).toBe(true);

		const bad = await s.validateResultAsync({ user: { email: "ada@x.io" } });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]?.rule).toBe("database.unique");
		expect(bad.errors[0]?.field).toBe("user.email");
	});

	it("validateResultAsync runs a unique() on every array item", async () => {
		const seen: string[] = [];
		const s = schema({
			emails: rules.array(
				rules.string().unique(async (value) => {
					seen.push(String(value));
					return String(value) !== "dupe@x.io";
				}),
			),
		});

		const res = await s.validateResultAsync({
			emails: ["a@x.io", "dupe@x.io", "b@x.io"],
		});
		expect(seen).toEqual(["a@x.io", "dupe@x.io", "b@x.io"]);
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.field).toBe("emails.1");
	});

	it("skips a nested async rule when the value already failed its sync rules", async () => {
		let called = false;
		const s = schema({
			user: rules.any().object({
				email: rules
					.string()
					.email()
					.unique(async () => {
						called = true;
						return true;
					}),
			}),
		});

		const res = await s.validateResultAsync({
			user: { email: "not-an-email" },
		});
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.rule).toBe("email");
		expect(called).toBe(false);
	});
});

describe("rune > a run's reporter error belongs to that run", () => {
	/** A reporter that stamps every error it builds with the run it came from. */
	class TaggedReporter {
		hasErrors = false;
		readonly fields: string[] = [];
		constructor(readonly tag: string) {}
		report(_message: string, _rule: string, field: { getFieldPath(): string }) {
			this.hasErrors = true;
			this.fields.push(field.getFieldPath());
		}
		createError(): Error {
			return new Error(`reporter ${this.tag}`);
		}
	}

	/** Two overlapping runs, each held on the same async rule until both started. */
	function overlapping() {
		let release = (): void => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const v = schema({
			email: rules.string().unique(async () => {
				await gate;
				return false;
			}),
		});
		return { v, release };
	}

	it("validate() throws each run's own reporter error", async () => {
		const { v, release } = overlapping();
		const a = v
			.validate(
				{ email: "a" },
				{ errorReporter: () => new TaggedReporter("A") },
			)
			.catch((error: unknown) => error);
		const b = v
			.validate(
				{ email: "b" },
				{ errorReporter: () => new TaggedReporter("B") },
			)
			.catch((error: unknown) => error);
		release();
		const [errorA, errorB] = await Promise.all([a, b]);
		expect(errorA).toMatchObject({ message: "reporter A" });
		expect(errorB).toMatchObject({ message: "reporter B" });
	});

	it("tryValidate() returns each run's own reporter error", async () => {
		const { v, release } = overlapping();
		const reporterFor = (tag: string) => () => {
			const reporter = new TaggedReporter(tag);
			return {
				get hasErrors() {
					return reporter.hasErrors;
				},
				report: reporter.report.bind(reporter),
				createError: () =>
					new RuneValidationError([
						{ message: tag, rule: "unique", field: "email" },
					]),
			};
		};
		const a = v.tryValidate(
			{ email: "a" },
			{ errorReporter: reporterFor("A") },
		);
		const b = v.tryValidate(
			{ email: "b" },
			{ errorReporter: reporterFor("B") },
		);
		release();
		const [[errorA], [errorB]] = await Promise.all([a, b]);
		expect(errorA?.messages[0]?.message).toBe("A");
		expect(errorB?.messages[0]?.message).toBe("B");
	});

	it("a run without a reporter never throws the previous run's reporter error", async () => {
		const v = schema({ email: rules.string() });
		await expect(
			v.validate({}, { errorReporter: () => new TaggedReporter("A") }),
		).rejects.toMatchObject({ message: "reporter A" });
		await expect(v.validate({})).rejects.toBeInstanceOf(RuneValidationError);
	});
});
