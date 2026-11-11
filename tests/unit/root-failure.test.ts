import { afterEach, describe, expect, it } from "vitest";
import rune, {
	create,
	rules,
	SimpleMessagesProvider,
	schema,
	setValidationTranslator,
} from "../../src/index.js";

/**
 * A payload that is not an object fails the root object's own type rule — on
 * field `""`, labelled "data", and through the same provider and translator
 * as every other failure.
 */
describe("rune > the root failure is an ordinary rule failure", () => {
	afterEach(() => {
		rune.messagesProvider = null;
		setValidationTranslator(undefined);
	});

	it('reports `object` on field `""` with the catalogue\'s text', () => {
		expect(schema({ a: rules.string() }).validateResult([]).errors).toEqual([
			{
				field: "",
				rule: "object",
				message: "The data field must be an object",
			},
		]);
	});

	it("goes through the messages provider", () => {
		const errors = schema({ a: rules.string() }).validateResult([], {
			messagesProvider: new SimpleMessagesProvider(
				{ object: "{{ field }} is not an object" },
				{ "": "payload" },
			),
		}).errors;
		expect(errors).toEqual([
			{ field: "", rule: "object", message: "payload is not an object" },
		]);
	});

	it("goes through the translator", () => {
		setValidationTranslator((key, params) =>
			key === "validation.object" ? `[${params?.field}] objet requis` : "",
		);
		const errors = schema({ a: rules.string() }).validateResult(7).errors;
		expect(errors[0]?.message).toBe("[data] objet requis");
	});

	it("goes through the async path the same way", async () => {
		const [error] = await create({ a: rules.string() }).tryValidate("x");
		expect(error?.messages).toEqual([
			{
				field: "",
				rule: "object",
				message: "The data field must be an object",
			},
		]);
	});
});

describe("rune > a scalar or array root", () => {
	it("create(rules.string()) validates the payload itself", async () => {
		const v = create(rules.string().trim().minLength(2));
		expect(await v.validate("  ab ")).toBe("ab");
		expect(v.validateResult(5).errors).toEqual([
			expect.objectContaining({ field: "", rule: "string" }),
		]);
		expect(v.validateResult("a").errors).toEqual([
			expect.objectContaining({ field: "", rule: "minLength" }),
		]);
		expect(v.toJSONSchema()).toMatchObject({ type: "string", minLength: 2 });
	});

	it("an array root names its items by index", () => {
		const v = create(rules.array(rules.number()));
		expect(v.validateResult([1, "x"]).errors).toEqual([
			expect.objectContaining({ field: "1", rule: "number", index: 1 }),
		]);
		expect(v.validateResult([1, 2])).toMatchObject({
			valid: true,
			data: [1, 2],
		});
	});

	it("~standard reports a root issue with an empty path", async () => {
		const result = await create(rules.string())["~standard"].validate(5);
		expect(result).toMatchObject({ issues: [{ path: [] }] });
	});
});
