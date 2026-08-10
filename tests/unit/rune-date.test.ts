import { afterEach, describe, expect, it } from "vitest";
import { rules, schema, setDateTransform } from "../../src/index.js";

/**
 * `rules.date()` — VineJS `vine.date()` parity. Parsing is done in-package
 * (rune stays zero-dependency, so no dayjs) and must stay calendar-strict: a
 * regex-shaped check would accept dates that do not exist.
 */
describe("rune > date", () => {
	afterEach(() => setDateTransform(null));

	it("parses ISO 8601 and yields a real Date in the output", () => {
		const s = schema({ at: rules.date() });
		const data = s.validateOrThrow({ at: "2026-06-25T10:00:00Z" });
		expect(data.at).toBeInstanceOf(Date);
		expect(data.at.toISOString()).toBe("2026-06-25T10:00:00.000Z");
	});

	it("rejects dates that match the shape but do not exist", () => {
		const s = schema({ at: rules.date() });
		for (const bad of [
			"2026-02-31",
			"2026-13-01",
			"2026-00-10",
			"not-a-date",
		]) {
			const res = s.validate({ at: bad });
			expect(res.valid, `${bad} must be rejected`).toBe(false);
			expect(res.errors[0]?.rule).toBe("date");
		}
		// …and the leap day that DOES exist still passes.
		expect(s.validate({ at: "2024-02-29" }).valid).toBe(true);
		expect(s.validate({ at: "2026-02-29" }).valid).toBe(false);
	});

	it("accepts unix timestamps and token formats", () => {
		const ms = schema({ at: rules.date({ formats: ["x"] }) });
		expect(ms.validateOrThrow({ at: "1750000000000" }).at.getTime()).toBe(
			1750000000000,
		);

		const fr = schema({ at: rules.date({ formats: ["DD/MM/YYYY"] }) });
		const parsed = fr.validateOrThrow({ at: "25/06/2026" });
		expect(parsed.at.getFullYear()).toBe(2026);
		expect(parsed.at.getMonth()).toBe(5);
		expect(parsed.at.getDate()).toBe(25);
		// The format is exclusive — an ISO string no longer matches.
		expect(fr.validate({ at: "2026-06-25" }).valid).toBe(false);
	});

	it("compares against literals and the 'today' keyword", () => {
		const s = schema({
			at: rules.date().after("2026-01-01").before("2030-12-31"),
		});
		expect(s.validate({ at: "2026-06-25" }).valid).toBe(true);
		expect(s.validate({ at: "2025-12-31" }).valid).toBe(false);
		expect(s.validate({ at: "2031-01-01" }).valid).toBe(false);

		const future = schema({ at: rules.date().after("today") });
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		expect(future.validate({ at: tomorrow.toISOString() }).valid).toBe(true);
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		expect(future.validate({ at: yesterday.toISOString() }).valid).toBe(false);
	});

	it("compares against a sibling field, optionally by day", () => {
		const s = schema({
			checkIn: rules.date(),
			checkOut: rules.date().afterField("checkIn"),
		});
		expect(
			s.validate({ checkIn: "2026-06-25", checkOut: "2026-06-28" }).valid,
		).toBe(true);
		const bad = s.validate({ checkIn: "2026-06-28", checkOut: "2026-06-25" });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]?.rule).toBe("afterField");

		// Same calendar day, later clock time: strict comparison passes, day-granular fails.
		const strict = schema({
			a: rules.date(),
			b: rules.date().afterField("a"),
		});
		expect(
			strict.validate({ a: "2026-06-25T08:00:00Z", b: "2026-06-25T09:00:00Z" })
				.valid,
		).toBe(true);
		const byDay = schema({
			a: rules.date(),
			b: rules.date().afterField("a", { compare: "day" }),
		});
		expect(
			byDay.validate({ a: "2026-06-25T08:00:00Z", b: "2026-06-25T09:00:00Z" })
				.valid,
		).toBe(false);
	});

	it("enforces weekend / weekday", () => {
		// 2026-06-27 is a Saturday, 2026-06-25 a Thursday.
		expect(
			schema({ d: rules.date().weekend() }).validate({ d: "2026-06-27" }).valid,
		).toBe(true);
		expect(
			schema({ d: rules.date().weekend() }).validate({ d: "2026-06-25" }).valid,
		).toBe(false);
		expect(
			schema({ d: rules.date().weekday() }).validate({ d: "2026-06-25" }).valid,
		).toBe(true);
		expect(
			schema({ d: rules.date().weekday() }).validate({ d: "2026-06-27" }).valid,
		).toBe(false);
	});

	it("maps the output through setDateTransform, after the comparisons ran", () => {
		setDateTransform((d) => ({ iso: d.toISOString() }));
		const s = schema({ at: rules.date().after("2026-01-01") });

		expect(s.validateOrThrow({ at: "2026-06-25T00:00:00Z" }).at).toEqual({
			iso: "2026-06-25T00:00:00.000Z",
		});

		// The comparison still sees a real Date — the mapping must not blind it.
		expect(s.validate({ at: "2025-01-01T00:00:00Z" }).valid).toBe(false);
	});

	it("respects optional() without inventing a date", () => {
		const s = schema({ at: rules.date().optional() });
		expect(s.validateOrThrow({}).at).toBeUndefined();
	});
});

describe("rune > date grammar and callable operands", () => {
	it("parses the Day.js tokens VineJS formats use", () => {
		const cases: Array<[string, string, [number, number, number]]> = [
			["D/M/YYYY", "5/6/2026", [2026, 5, 5]],
			["YY-MM-DD", "26-06-25", [2026, 5, 25]],
			["YY-MM-DD", "95-06-25", [1995, 5, 25]],
		];
		for (const [format, input, [y, m, d]] of cases) {
			const out = schema({
				at: rules.date({ formats: [format] }),
			}).validateOrThrow({ at: input });
			expect(out.at.getFullYear(), format).toBe(y);
			expect(out.at.getMonth(), format).toBe(m);
			expect(out.at.getDate(), format).toBe(d);
		}
	});

	it("handles 12-hour clocks with a meridiem", () => {
		const s = schema({ at: rules.date({ formats: ["YYYY-MM-DD hh:mm A"] }) });
		expect(s.validateOrThrow({ at: "2026-06-25 01:30 PM" }).at.getHours()).toBe(
			13,
		);
		expect(s.validateOrThrow({ at: "2026-06-25 12:00 AM" }).at.getHours()).toBe(
			0,
		);
		// 13 on a 12-hour clock is not a time.
		expect(s.validate({ at: "2026-06-25 13:00 PM" }).valid).toBe(false);
	});

	it("escapes a literal run with [...]", () => {
		const s = schema({
			at: rules.date({ formats: ["YYYY-MM-DD [at] HH:mm"] }),
		});
		expect(s.validate({ at: "2026-06-25 at 10:30" }).valid).toBe(true);
		expect(s.validate({ at: "2026-06-25 pm 10:30" }).valid).toBe(false);
	});

	it("resolves a callable operand at validation time, not at declaration", () => {
		let boundary = "2026-01-01";
		const s = schema({ at: rules.date().after(() => boundary) });
		expect(s.validate({ at: "2026-06-25" }).valid).toBe(true);
		boundary = "2027-01-01";
		// The boundary moved, so the same input is now refused.
		expect(s.validate({ at: "2026-06-25" }).valid).toBe(false);
	});
});
