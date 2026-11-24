/**
 * A lone UTF-16 surrogate is valid JSON (`"\ud800"`), and the native engine's
 * parser refuses it. Such a payload is validated by the TypeScript traversal:
 * the caller gets a verdict, the same one whichever engine would have run.
 */
import { describe, expect, it, vi } from "vitest";

/** Counts the engine calls; the real engine still answers. */
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

const { default: rune, SimpleMessagesProvider } = await import(
	"../../src/index.js"
);

const schema = rune.create({
	name: rune.string().maxLength(50),
	age: rune.number().min(18),
});

/** Forces the TypeScript traversal, as the reference verdict. */
const viaTypeScript = { messagesProvider: new SimpleMessagesProvider({}) };

const HIGH = "\ud800";
const LOW = "\udc00";

describe("rune > a lone surrogate gets a verdict", () => {
	it.each([
		["a lone high surrogate", JSON.parse('{"name":"\\ud800","age":"30"}')],
		["a lone low surrogate", JSON.parse('{"name":"a\\udc00b","age":"30"}')],
		["a reversed pair", { name: `${LOW}${HIGH}`, age: 30 }],
	])("%s in a declared string validates", async (_label, body) => {
		const before = engineCalls.count;
		const result = schema.validateResult(body);
		expect(result).toEqual(schema.validateResult(body, viaTypeScript));
		expect(result.valid).toBe(true);
		expect(await schema.validate(body)).toEqual(result.data);
		const [error, data] = await schema.tryValidate(body);
		expect(error).toBeNull();
		expect(data).toEqual(result.data);
		// The engine was never asked to parse it.
		expect(engineCalls.count).toBe(before);
	});

	it.each([
		["in a nested value", { name: ["ok", { deep: HIGH }], age: 30 }],
		["in an object key", { name: { [HIGH]: 1 }, age: 30 }],
		["in a nested object key", { name: [{ a: { [`x${LOW}`]: 1 } }], age: 30 }],
	])(
		"a lone surrogate %s is refused by the type rule, not thrown",
		async (_label, body) => {
			const result = schema.validateResult(body);
			expect(result.valid).toBe(false);
			expect(result.errors.map((error) => [error.field, error.rule])).toEqual([
				["name", "string"],
			]);
			expect(schema.validateResult(body, viaTypeScript).errors).toEqual(
				result.errors,
			);
			const [error] = await schema.tryValidate(body);
			expect(error?.messages.map((node) => node.rule)).toEqual(["string"]);
			await expect(schema.validate(body)).rejects.toMatchObject({
				code: "E_VALIDATION_ERROR",
			});
		},
	);

	it("a refused value still fails its rules on that path", () => {
		const result = schema.validateResult({ name: HIGH.repeat(51), age: "3" });
		expect(result.errors.map((error) => error.rule)).toEqual([
			"maxLength",
			"min",
		]);
	});

	it("a well-formed pair still goes to the engine", () => {
		const before = engineCalls.count;
		expect(schema.validateResult({ name: "ok 😀", age: 30 }).valid).toBe(true);
		expect(engineCalls.count).toBe(before + 1);
	});
});

describe("rune > a request the engine refuses to read", () => {
	it("falls back to the TypeScript traversal instead of throwing", async () => {
		// The lone surrogate is in the SCHEMA here, so no payload check sees it:
		// the engine receives the request and refuses it.
		const prefixed = rune.create({ code: rune.string().startsWith(HIGH) });
		const before = engineCalls.count;
		const refused = prefixed.validateResult({ code: "abc" });
		// The engine was asked, and could not read the request.
		expect(engineCalls.count).toBe(before + 1);
		expect(refused.errors.map((error) => error.rule)).toEqual(["startsWith"]);
		const [error] = await prefixed.tryValidate({ code: "abc" });
		expect(error?.messages.map((node) => node.rule)).toEqual(["startsWith"]);
		expect(prefixed.validateResult({ code: `${HIGH}abc` })).toEqual({
			valid: true,
			errors: [],
			data: { code: `${HIGH}abc` },
		});
	});
});
