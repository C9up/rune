import { afterEach, describe, expect, it, vi } from "vitest";
import {
	bindRosetta,
	rules,
	schema,
	setValidationTranslator,
} from "../../src/index.js";
import { warnNativeUnavailableOnce } from "../../src/native.js";

/**
 * Minimal stand-in for a translator (e.g. `@c9up/rosetta`). `bindRosetta`
 * accepts any object exposing `t(key, params)`, so rune stays agnostic and is
 * tested in isolation — the real i18n pairing lives in the kitchen-sink app.
 */
function fakeTranslator(messages: Record<string, string>) {
	return {
		t(key: string, params?: Record<string, unknown>): string {
			const tmpl = messages[key] ?? key;
			return tmpl.replace(/\{(\w+)\}/g, (_m, k) =>
				String(params?.[k] ?? `{${k}}`),
			);
		},
	};
}

afterEach(() => {
	setValidationTranslator(undefined);
});

describe("rune > schema validation", () => {
	it("validates valid data", () => {
		const s = schema({
			name: rules.string().min(3).max(100),
			email: rules.string().email(),
			age: rules.number().positive(),
		});

		const result = s.validate({
			name: "Kaen",
			email: "kaen@c9up.com",
			age: 28,
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.data?.name).toBe("Kaen");
	});

	it("rejects invalid data with errors", () => {
		const s = schema({
			name: rules.string().min(3),
			email: rules.string().email(),
		});

		const result = s.validate({ name: "Ka", email: "not-an-email" });
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBe(2);
		const fields = result.errors.map((e) => e.field).sort();
		expect(fields).toEqual(["email", "name"]);
		expect(result.errors.find((e) => e.field === "name")?.rule).toBe("min");
	});

	it("duplicate min() rules each serialize their own bound (no find-first collapse)", () => {
		// min(3).min(5): a length-4 string passes the 3 bound but must fail the 5.
		// Before the fix both Rust entries got min=3, dropping the 5 (audit 2026-06-13).
		const s = schema({ name: rules.string().min(3).min(5) });
		expect(s.validate({ name: "abcd" }).valid).toBe(false); // len 4 < 5
		expect(s.validate({ name: "abcde" }).valid).toBe(true); // len 5 ok
	});

	it("reports missing required fields", () => {
		const s = schema({ name: rules.string() });
		const result = s.validate({});
		expect(result.valid).toBe(false);
		expect(result.errors[0].rule).toBe("required");
	});

	it("optional fields skip validation when absent", () => {
		const s = schema({ bio: rules.string().optional() });
		const result = s.validate({});
		expect(result.valid).toBe(true);
	});

	it("applies transforms (trim)", () => {
		const s = schema({ name: rules.string().trim().min(3) });
		const result = s.validate({ name: "  Kaen  " });
		expect(result.valid).toBe(true);
		expect(result.data?.name).toBe("Kaen");
	});
});

describe("rune > rule types", () => {
	it("string rule", () => {
		const s = schema({ x: rules.string() });
		expect(s.validate({ x: "hello" }).valid).toBe(true);
		expect(s.validate({ x: 123 }).valid).toBe(false);
	});

	it("number rule", () => {
		const s = schema({ x: rules.number() });
		expect(s.validate({ x: 42 }).valid).toBe(true);
		expect(s.validate({ x: "nope" }).valid).toBe(false);
	});

	it("boolean rule", () => {
		const s = schema({ x: rules.boolean() });
		expect(s.validate({ x: true }).valid).toBe(true);
		expect(s.validate({ x: "yes" }).valid).toBe(false);
	});

	it("positive rule", () => {
		const s = schema({ x: rules.number().positive() });
		expect(s.validate({ x: 5 }).valid).toBe(true);
		expect(s.validate({ x: -1 }).valid).toBe(false);
		expect(s.validate({ x: 0 }).valid).toBe(false);
	});

	it("email rule", () => {
		const s = schema({ x: rules.string().email() });
		expect(s.validate({ x: "a@b.com" }).valid).toBe(true);
		expect(s.validate({ x: "nope" }).valid).toBe(false);
		// Audit 2026-06-13: reject interior whitespace to match the Rust engine —
		// the old TS rule rejected only \r\n, silently accepting spaces/tabs so the
		// same schema validated differently with vs without the native binary.
		expect(s.validate({ x: "a b@c.com" }).valid).toBe(false);
		expect(s.validate({ x: "a@b .com" }).valid).toBe(false);
		expect(s.validate({ x: "a@b.com\t" }).valid).toBe(false);
	});

	it("custom rule", () => {
		const s = schema({
			phone: rules
				.string()
				.custom(
					"frenchPhone",
					(v) => /^0[1-9]\d{8}$/.test(v as string),
					"Invalid French phone",
				),
		});
		expect(s.validate({ phone: "0612345678" }).valid).toBe(true);
		expect(s.validate({ phone: "123" }).valid).toBe(false);
	});

	it("custom error message", () => {
		const s = schema({
			email: rules
				.string()
				.email()
				.message("Please enter a valid email address"),
		});
		const result = s.validate({ email: "bad" });
		expect(result.errors[0].message).toBe("Please enter a valid email address");
	});

	it("preserves custom message on min/max", () => {
		const s = schema({
			name: rules
				.string()
				.min(5)
				.message("Name too short")
				.max(10)
				.message("Name too long"),
		});

		const tooShort = s.validate({ name: "abc" });
		expect(tooShort.valid).toBe(false);
		expect(tooShort.errors[0].message).toBe("Name too short");

		const tooLong = s.validate({ name: "abcdefghijkl" });
		expect(tooLong.valid).toBe(false);
		expect(tooLong.errors[0].message).toBe("Name too long");
	});
});

describe("rune > security & edge cases", () => {
	it("rejects email with newline (header injection)", () => {
		const s = schema({ email: rules.string().email() });
		expect(s.validate({ email: "user@example.com\n" }).valid).toBe(false);
		expect(
			s.validate({ email: "user@example.com\r\nBcc: evil@hacker.com" }).valid,
		).toBe(false);
	});

	it("rejects Infinity as number", () => {
		const s = schema({ x: rules.number() });
		expect(s.validate({ x: Infinity }).valid).toBe(false);
		expect(s.validate({ x: -Infinity }).valid).toBe(false);
	});

	it("rejects Infinity in positive", () => {
		const s = schema({ x: rules.number().positive() });
		expect(s.validate({ x: Infinity }).valid).toBe(false);
	});

	it("rejects NaN", () => {
		const s = schema({ x: rules.number() });
		expect(s.validate({ x: NaN }).valid).toBe(false);
	});

	it("handles null input to schema.validate", () => {
		const s = schema({ name: rules.string() });
		const result = s.validate(null as unknown as Record<string, unknown>);
		expect(result.valid).toBe(false);
		expect(result.errors[0].field).toBe("_root");
	});

	it("handles undefined input to schema.validate", () => {
		const s = schema({ name: rules.string() });
		const result = s.validate(undefined as unknown as Record<string, unknown>);
		expect(result.valid).toBe(false);
	});

	it("message() throws if no rule exists", () => {
		expect(() => rules.any().message("test")).toThrow(
			"message() must be called after a rule",
		);
	});

	it("custom rule default message", () => {
		const s = schema({
			x: rules
				.string()
				.custom("slug", (v) => typeof v === "string" && /^[a-z-]+$/.test(v)),
		});
		const result = s.validate({ x: "NOT_A_SLUG" });
		expect(result.errors[0].message).toBe("Failed custom rule: slug");
	});
});

describe("rune > translator integration", () => {
	it("uses the bound translator for default rule messages", () => {
		const i18n = fakeTranslator({
			"validation.required": "{field} est requis",
			"validation.email": "Email invalide",
		});

		bindRosetta(i18n);

		const s = schema({ email: rules.string().email() });
		const result = s.validate({});
		expect(result.errors[0].message).toBe("email est requis");

		const invalid = s.validate({ email: "bad" });
		expect(invalid.errors[0].message).toBe("Email invalide");
	});

	it("keeps explicit custom messages over translations", () => {
		const i18n = fakeTranslator({
			"validation.min": "Trop petit",
		});
		bindRosetta(i18n);

		const s = schema({
			name: rules.string().min(5).message("Custom min message"),
		});

		const result = s.validate({ name: "abc" });
		expect(result.errors[0].message).toBe("Custom min message");
	});
});

describe("rune > native fallback visibility (audit 2026-06-13)", () => {
	it("warns at most once when the native engine is unavailable (no silent fallback)", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			warnNativeUnavailableOnce();
			warnNativeUnavailableOnce();
			// A silent fallback made validation platform-dependent; surfacing it
			// exactly once is the contract — not zero, not per-validate spam.
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("platform-dependent"),
			);
		} finally {
			warn.mockRestore();
		}
	});
});
