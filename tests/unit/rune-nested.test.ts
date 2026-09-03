import { describe, expect, it } from "vitest";
import { rules, schema } from "../../src/index.js";

/** Narrow away null/undefined without a `!` assertion (which lies to the compiler). */
function defined<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("expected a defined value");
	return value;
}


describe("rune > nested object schemas", () => {
	it("validates a nested object shape and surfaces field-paths in errors", () => {
		const s = schema({
			user: rules.any().object({
				name: rules.string().min(2),
				age: rules.number().positive(),
			}),
		});
		const ok = s.validateResult({ user: { name: "Alice", age: 30 } });
		expect(ok.valid).toBe(true);

		const bad = s.validateResult({ user: { name: "A", age: -1 } });
		expect(bad.valid).toBe(false);
		const fields = bad.errors.map((e) => e.field).sort();
		expect(fields).toEqual(["user.age", "user.name"]);
	});

	it("rejects a non-object where a nested object is expected, before recursing", () => {
		const s = schema({
			user: rules.any().object({ name: rules.string() }),
		});
		const result = s.validateResult({ user: "not-an-object" });
		expect(result.valid).toBe(false);
		// The 'object' type rule short-circuits — no .name traversal.
		expect(result.errors).toHaveLength(1);
		expect(defined(result.errors[0]).field).toBe("user");
		expect(defined(result.errors[0]).rule).toBe("object");
	});

	it("returns transformed nested values (e.g., trimmed) in result.data", () => {
		const s = schema({
			user: rules.any().object({
				name: rules.string().trim(),
			}),
		});
		const result = s.validateResult({ user: { name: "  Bob  " } });
		expect(result.valid).toBe(true);
		expect(result.data?.user).toEqual({ name: "Bob" });
	});
});

describe("rune > array item validation", () => {
	it("validates each item against the provided item-chain", () => {
		const s = schema({
			tags: rules.any().array(rules.string().min(2)),
		});
		const ok = s.validateResult({ tags: ["hi", "hello"] });
		expect(ok.valid).toBe(true);

		const bad = s.validateResult({ tags: ["hi", "x", "ok"] });
		expect(bad.valid).toBe(false);
		expect(defined(bad.errors[0]).field).toBe("tags.1");
	});

	it("accepts arrays without an item-chain (just a type check)", () => {
		const s = schema({ items: rules.any().array() });
		expect(s.validateResult({ items: [1, "two", true] }).valid).toBe(true);
		expect(s.validateResult({ items: "not-an-array" }).valid).toBe(false);
	});

	it("returns a transformed copy in data when items have transforms", () => {
		const s = schema({
			tags: rules.any().array(rules.string().trim()),
		});
		const result = s.validateResult({ tags: ["  a  ", "b"] });
		expect(result.valid).toBe(true);
		expect(result.data?.tags).toEqual(["a", "b"]);
	});
});

describe("rune > rules.any() and chain edge cases", () => {
	it("rules.any() with no rules accepts any non-null value", () => {
		const s = schema({ x: rules.any() });
		expect(s.validateResult({ x: 1 }).valid).toBe(true);
		expect(s.validateResult({ x: "str" }).valid).toBe(true);
		expect(s.validateResult({ x: { nested: true } }).valid).toBe(true);
	});

	it("optional() lets null/undefined pass without error", () => {
		const s = schema({
			a: rules.string().optional(),
			b: rules.number().optional(),
		});
		expect(s.validateResult({ a: null, b: undefined }).valid).toBe(true);
	});

	it("array as schema input is rejected at root (Array.isArray branch)", () => {
		const s = schema({ x: rules.string() });
		// `Schema.validateResult(data: unknown)` accepts unknown by design — no cast
		// needed for runtime-shape testing.
		const result = s.validateResult([1, 2, 3]);
		expect(result.valid).toBe(false);
		expect(defined(result.errors[0]).field).toBe("_root");
	});
});
