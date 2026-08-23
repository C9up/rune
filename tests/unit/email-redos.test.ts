/**
 * `email({ allow_display_name: true })` used a pattern where `\s*` and
 * `[^<>@]*?` could both claim a space, so N spaces had N ways to split and the
 * engine tried them all — measured O(n³), 8 KB of spaces blocking the event
 * loop for 67 seconds. Any route validating an email was a denial of service.
 */
import { describe, expect, it } from "vitest";
import { isEmail } from "../../src/formats.js";

describe("rune > email display name", () => {
	it("answers immediately on the input that used to hang", () => {
		const started = performance.now();
		expect(isEmail(" ".repeat(8000), { allow_display_name: true })).toBe(false);
		expect(performance.now() - started).toBeLessThan(50);
	});

	it("stays flat as the input grows", () => {
		const time = (n: number): number => {
			const started = performance.now();
			isEmail(`${" ".repeat(n)}@`, { allow_display_name: true });
			return performance.now() - started;
		};
		time(1000);
		expect(time(32_000)).toBeLessThan(50);
	});

	it("still accepts the display-name forms", () => {
		const opts = { allow_display_name: true };
		expect(isEmail("Ada Lovelace <ada@example.com>", opts)).toBe(true);
		expect(isEmail('"Lovelace, Ada" <ada@example.com>', opts)).toBe(true);
		expect(isEmail("  Ada  <ada@example.com>  ", opts)).toBe(true);
		expect(isEmail("ada@example.com", opts)).toBe(true);
	});

	it("lets a quoted display name carry the characters a bare one cannot", () => {
		const opts = { allow_display_name: true };
		expect(isEmail('"a<b>c" <ada@example.com>', opts)).toBe(true);
		expect(isEmail('"a@b" <ada@example.com>', opts)).toBe(true);
	});

	it("still rejects what the pattern rejected", () => {
		const opts = { allow_display_name: true };
		expect(isEmail("a@b <ada@example.com>", opts)).toBe(false);
		expect(isEmail("Ada <>", opts)).toBe(false);
		expect(isEmail("Ada <ada@example.com", opts)).toBe(false);
		expect(isEmail("<ada@example.com>", opts)).toBe(true);
	});

	it("refuses an input longer than a mail line can be", () => {
		expect(isEmail(`${"a".repeat(1000)}@example.com`)).toBe(false);
		expect(
			isEmail(`${"a".repeat(1000)}@example.com`, { ignore_max_length: true }),
		).toBe(false);
	});
});
