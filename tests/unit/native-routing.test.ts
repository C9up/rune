import { describe, expect, it, vi } from "vitest";

/**
 * The engine call is counted through the module the schema imports it from.
 * Wrapping, not replacing: the real engine still answers.
 */
const engineCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../src/native.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../../src/native.js")>();
	return {
		...original,
		validateNative: (request: string) => {
			engineCalls.count++;
			return original.validateNative(request);
		},
	};
});

const { rules, schema } = await import("../../src/index.js");

/** How many times `run` reached the engine. */
async function engineCallsDuring(run: () => unknown): Promise<number> {
	const before = engineCalls.count;
	await run();
	return engineCalls.count - before;
}

describe("rune > every entry point routes a native schema to the engine", () => {
	const v = schema({ name: rules.string().minLength(2) });

	it("the async entry points use the engine like the sync ones", async () => {
		expect(
			await engineCallsDuring(() => v.validateResult({ name: "ab" })),
		).toBe(1);
		expect(
			await engineCallsDuring(() => v.validateResultAsync({ name: "ab" })),
		).toBe(1);
		expect(await engineCallsDuring(() => v.validate({ name: "ab" }))).toBe(1);
		expect(await engineCallsDuring(() => v.tryValidate({ name: "a" }))).toBe(1);
		expect(
			await engineCallsDuring(() => v["~standard"].validate({ name: "ab" })),
		).toBe(1);
	});

	it("a schema the engine cannot run stays off it on both paths", async () => {
		const custom = schema({ name: rules.string().trim() });
		expect(
			await engineCallsDuring(() => custom.validateResult({ name: "ab" })),
		).toBe(0);
		expect(await engineCallsDuring(() => custom.validate({ name: "ab" }))).toBe(
			0,
		);
	});
});

describe("rune > the engine answers like the TypeScript path", () => {
	it("reports errors in declaration order, not sorted by name", async () => {
		const v = schema({ zeta: rules.string(), alpha: rules.string() });
		const fields = (await v.validateResultAsync({})).errors.map(
			(error) => error.field,
		);
		expect(fields).toEqual(["zeta", "alpha"]);
		expect(v.validateResult({}).errors.map((error) => error.field)).toEqual([
			"zeta",
			"alpha",
		]);
	});

	it("renders a repeated rule's message from the bound that failed", () => {
		const v = schema({ age: rules.number().min(3).min(5) });
		expect(v.validateResult({ age: 4 }).errors).toEqual([
			{
				field: "age",
				rule: "min",
				message: "The age field must be at least 5",
			},
		]);
	});
});
