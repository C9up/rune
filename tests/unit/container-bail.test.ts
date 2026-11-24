/**
 * The children of a container that already failed one of its own rules are
 * not validated: no item rule runs and no item lookup is queued. Sizes stay
 * small on purpose — what is measured is "zero", not a load.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import rune from "../../src/index.js";

let lookups = 0;
rune.bindDatabase({
	exists: async () => {
		lookups++;
		return true;
	},
});
afterAll(() => rune.bindDatabase(null));

let runs = 0;
const counted = rune.createRule(() => {
	runs++;
});

beforeEach(() => {
	lookups = 0;
	runs = 0;
});

const ids = (count: number) =>
	Array.from({ length: count }, (_, index) => index + 1);

describe("rune > an array that failed its own rule", () => {
	const tagIds = () =>
		rune.array(rune.number().exists({ table: "tags", column: "id" }));

	it.each([10, 200])(
		"%i items over maxLength(5): no lookup at all",
		async (count) => {
			const schema = rune.create({ tag_ids: tagIds().maxLength(5) });
			const result = await schema.validateResultAsync({ tag_ids: ids(count) });
			expect(result.valid).toBe(false);
			expect(result.errors.map((error) => error.rule)).toEqual([
				"array.maxLength",
			]);
			expect(lookups).toBe(0);
			await expect(
				schema.validate({ tag_ids: ids(count) }),
			).rejects.toMatchObject({ code: "E_VALIDATION_ERROR" });
			expect(lookups).toBe(0);
		},
	);

	it("an array within its limit has every item looked up", async () => {
		const schema = rune.create({ tag_ids: tagIds().maxLength(5) });
		expect((await schema.validateResultAsync({ tag_ids: ids(4) })).valid).toBe(
			true,
		);
		expect(lookups).toBe(4);
	});

	it("the synchronous item rules do not run either", () => {
		const schema = rune.create({
			tags: rune.array(rune.string().use(counted())).maxLength(2),
		});
		expect(schema.validateResult({ tags: new Array(50).fill("a") }).valid).toBe(
			false,
		);
		expect(runs).toBe(0);
		expect(schema.validateResult({ tags: ["a", "b"] }).valid).toBe(true);
		expect(runs).toBe(2);
	});

	it.each([
		["minLength", () => rune.array(rune.string().use(counted())).minLength(3)],
		[
			"fixedLength",
			() => rune.array(rune.string().use(counted())).fixedLength(3),
		],
		["distinct", () => rune.array(rune.string().use(counted())).distinct()],
	])("%s stops the walk the same way", (_name, build) => {
		const schema = rune.create({ tags: build() });
		expect(schema.validateResult({ tags: ["a", "a"] }).valid).toBe(false);
		expect(runs).toBe(0);
	});

	it("bail(false) still walks the items", async () => {
		const schema = rune.create({ tag_ids: tagIds().maxLength(5).bail(false) });
		const result = await schema.validateResultAsync({ tag_ids: ids(8) });
		expect(result.valid).toBe(false);
		// The item chains are clean, so their lookups are queued.
		expect(lookups).toBe(8);

		const sync = rune.create({
			tags: rune.array(rune.number().use(counted())).maxLength(2).bail(false),
		});
		const mixed = sync.validateResult({ tags: [1, "x", 3] });
		expect(runs).toBe(2);
		expect(mixed.errors.map((error) => error.rule)).toEqual([
			"array.maxLength",
			"number",
		]);
	});
});

describe("rune > the other containers", () => {
	it("a record over its maxLength has no value validated", () => {
		const schema = rune.create({
			labels: rune.record(rune.string().use(counted())).maxLength(2),
		});
		const result = schema.validateResult({
			labels: { a: "1", b: "2", c: "3" },
		});
		expect(result.errors.map((error) => error.rule)).toEqual([
			"record.maxLength",
		]);
		expect(runs).toBe(0);
	});

	it("a record whose keys are refused has no value validated", () => {
		const schema = rune.create({
			labels: rune
				.record(rune.string().use(counted()))
				.validateKeys((keys, field) => {
					if (keys.some((key) => key.startsWith("_"))) {
						field.report("Private keys are refused", "record.keys");
					}
				}),
		});
		const result = schema.validateResult({ labels: { _a: "1", b: 2 } });
		expect(result.errors.map((error) => error.rule)).toEqual(["record.keys"]);
		expect(runs).toBe(0);
		expect(schema.validateResult({ labels: { a: "1", b: "2" } }).valid).toBe(
			true,
		);
		expect(runs).toBe(2);
	});

	it("a tuple of the wrong length has no position validated", () => {
		const schema = rune.create({
			pair: rune.tuple([
				rune.string().use(counted()),
				rune.string().use(counted()),
			]),
		});
		const result = schema.validateResult({ pair: ["a", "b", "c"] });
		expect(result.errors.map((error) => error.rule)).toEqual(["tuple"]);
		expect(runs).toBe(0);
	});

	it("an object refused by its own rule has no property validated", () => {
		const closed = rune.createRule((_value, _options, field) => {
			field.report("Registration is closed", "closed");
		});
		const schema = rune.create({
			form: rune.object({ name: rune.string().use(counted()) }).use(closed()),
		});
		const result = schema.validateResult({ form: { name: 4 } });
		expect(result.errors.map((error) => error.rule)).toEqual(["closed"]);
		expect(runs).toBe(0);
	});
});
