import { describe, expect, it } from "vitest";
import { rules, schema } from "../../src/index.js";

describe("rune > nested object schemas", () => {
	it("validates a nested object shape and surfaces field-paths in errors", () => {
		const s = schema({
			user: rules.any().object({
				name: rules.string().min(2),
				age: rules.number().positive(),
			}),
		});
		const ok = s.validate({ user: { name: "Alice", age: 30 } });
		expect(ok.valid).toBe(true);

		const bad = s.validate({ user: { name: "A", age: -1 } });
		expect(bad.valid).toBe(false);
		const fields = bad.errors.map((e) => e.field).sort();
		expect(fields).toEqual(["user.age", "user.name"]);
	});

	it("rejects a non-object where a nested object is expected, before recursing", () => {
		const s = schema({
			user: rules.any().object({ name: rules.string() }),
		});
		const result = s.validate({ user: "not-an-object" });
		expect(result.valid).toBe(false);
		// The 'object' type rule short-circuits — no .name traversal.
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].field).toBe("user");
		expect(result.errors[0].rule).toBe("object");
	});

	it("returns transformed nested values (e.g., trimmed) in result.data", () => {
		const s = schema({
			user: rules.any().object({
				name: rules.string().trim(),
			}),
		});
		const result = s.validate({ user: { name: "  Bob  " } });
		expect(result.valid).toBe(true);
		expect(result.data?.user).toEqual({ name: "Bob" });
	});
});

describe("rune > array item validation", () => {
	it("validates each item against the provided item-chain", () => {
		const s = schema({
			tags: rules.any().array(rules.string().min(2)),
		});
		const ok = s.validate({ tags: ["hi", "hello"] });
		expect(ok.valid).toBe(true);

		const bad = s.validate({ tags: ["hi", "x", "ok"] });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0].field).toBe("tags.1");
	});

	it("accepts arrays without an item-chain (just a type check)", () => {
		const s = schema({ items: rules.any().array() });
		expect(s.validate({ items: [1, "two", true] }).valid).toBe(true);
		expect(s.validate({ items: "not-an-array" }).valid).toBe(false);
	});

	it("returns a transformed copy in data when items have transforms", () => {
		const s = schema({
			tags: rules.any().array(rules.string().trim()),
		});
		const result = s.validate({ tags: ["  a  ", "b"] });
		expect(result.valid).toBe(true);
		expect(result.data?.tags).toEqual(["a", "b"]);
	});
});

describe("rune > rules.any() and chain edge cases", () => {
	it("rules.any() with no rules accepts any non-null value", () => {
		const s = schema({ x: rules.any() });
		expect(s.validate({ x: 1 }).valid).toBe(true);
		expect(s.validate({ x: "str" }).valid).toBe(true);
		expect(s.validate({ x: { nested: true } }).valid).toBe(true);
	});

	it("optional() lets null/undefined pass without error", () => {
		const s = schema({
			a: rules.string().optional(),
			b: rules.number().optional(),
		});
		expect(s.validate({ a: null, b: undefined }).valid).toBe(true);
	});

	it("array as schema input is rejected at root (Array.isArray branch)", () => {
		const s = schema({ x: rules.string() });
		// `Schema.validate(data: unknown)` accepts unknown by design — no cast
		// needed for runtime-shape testing.
		const result = s.validate([1, 2, 3]);
		expect(result.valid).toBe(false);
		expect(result.errors[0].field).toBe("_root");
	});
});
