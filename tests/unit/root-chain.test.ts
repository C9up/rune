import { describe, expect, it } from "vitest";
import rune, { create, rules } from "../../src/index.js";

/**
 * `create(rune.object({...}))` validates THROUGH the object chain it was given,
 * so whatever is set on the object itself applies at the root exactly as it
 * does one level down.
 */
describe("rune > create() honours the root object chain", () => {
	it("denyUnknownProperties() at the root refuses an undeclared key", async () => {
		const v = create(
			rune.object({ name: rules.string() }).denyUnknownProperties(),
		);
		const [error] = await v.tryValidate({ name: "x", extra: 1 });
		expect(error?.messages).toEqual([
			expect.objectContaining({ field: "extra", rule: "unknownField" }),
		]);
		expect(() => v.validateOrThrow({ name: "x", extra: 1 })).toThrow();
	});

	it("allowUnknownProperties() at the root keeps the key the schema says it keeps", async () => {
		const v = create(
			rune.object({ name: rules.string() }).allowUnknownProperties(),
		);
		expect(await v.validate({ name: "x", extra: 1 })).toEqual({
			name: "x",
			extra: 1,
		});
		expect(v.toJSONSchema()).toMatchObject({ additionalProperties: true });
	});

	it("merge(group) at the root validates and keeps the grouped field", async () => {
		const v = create(
			rune.object({ type: rules.string() }).merge(
				rune.group([
					rune.group.if((d) => d.type === "a", {
						secret: rules.string(),
					}),
				]),
			),
		);
		const [error] = await v.tryValidate({ type: "a", secret: 5 });
		expect(error?.messages).toEqual([
			expect.objectContaining({ field: "secret", rule: "string" }),
		]);
		expect(await v.validate({ type: "a", secret: "s" })).toEqual({
			type: "a",
			secret: "s",
		});
	});

	it("a group at the root carrying an async rule keeps the sync path closed", () => {
		const v = create(
			rune.object({ type: rules.string() }).merge(
				rune.group([
					rune.group.if(() => true, {
						email: rules.string().unique(async () => true),
					}),
				]),
			),
		);
		expect(() => v.validateResult({ type: "a", email: "x" })).toThrow(
			/validateResultAsync/,
		);
	});

	it("toCamelCase() at the root renames the keys", async () => {
		const v = create(rune.object({ first_name: rules.string() }).toCamelCase());
		expect(await v.validate({ first_name: "x" })).toEqual({ firstName: "x" });
		expect(v.validateResult({ first_name: "x" })).toMatchObject({
			valid: true,
			data: { firstName: "x" },
		});
	});

	it("a root error names the field without a leading dot", () => {
		const v = create(rune.object({ name: rules.string() }));
		expect(v.validateResult({ name: 1 }).errors[0]?.field).toBe("name");
	});
});
