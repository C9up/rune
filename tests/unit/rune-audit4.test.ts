import { describe, expect, it } from "vitest";
import rune, {
	createRule,
	rules,
	schema,
	setConvertEmptyStringsToNull,
} from "../../src/index.js";

describe("rune > audit 4", () => {
	it("file() accepts an Adonis-shaped upload and enforces size/extnames", () => {
		const s = schema({
			avatar: rules.file({ size: 1024, extnames: ["png", "jpg"] }),
		});
		expect(
			s.validateResult({ avatar: { size: 500, extname: "png" } }).valid,
		).toBe(true);
		// Name-derived extension works too (no `extname` field).
		expect(
			s.validateResult({ avatar: { size: 500, clientName: "a.JPG" } }).valid,
		).toBe(true);
		expect(
			s.validateResult({ avatar: { size: 5000, extname: "png" } }).valid,
		).toBe(false);
		expect(
			s.validateResult({ avatar: { size: 10, extname: "exe" } }).valid,
		).toBe(false);
		expect(s.validateResult({ avatar: "not-a-file" }).valid).toBe(false);
	});

	it("nonPositive and the decimal range", () => {
		expect(
			schema({ n: rules.number().nonPositive() }).validateResult({ n: 0 })
				.valid,
		).toBe(true);
		expect(
			schema({ n: rules.number().nonPositive() }).validateResult({ n: 1 })
				.valid,
		).toBe(false);

		const ranged = schema({ n: rules.number().decimal([2, 4]) });
		expect(ranged.validateResult({ n: 1.23 }).valid).toBe(true);
		expect(ranged.validateResult({ n: 1.2 }).valid).toBe(false);
		expect(ranged.validateResult({ n: 1.23456 }).valid).toBe(false);
	});

	it("convertEmptyStringsToNull makes an empty input absent", () => {
		const s = schema({ bio: rules.string().minLength(3).optional() });
		// Off by default: "" is a present string, and it is too short.
		expect(s.validateResult({ bio: "" }).valid).toBe(false);

		setConvertEmptyStringsToNull(true);
		expect(s.validateOrThrow({ bio: "" }).bio).toBeUndefined();
		setConvertEmptyStringsToNull(false);
	});

	it("exposes bindHostResolver on the default export", () => {
		expect(typeof rune.bindHostResolver).toBe("function");
		expect(typeof rune.file).toBe("function");
	});

	it("toJSON introspects the compiled schema", () => {
		const v = schema({
			email: rules.string().email(),
			age: rules.number().optional(),
		});
		// VineJS shape is `{ schema, refs }`, not a flat field map.
		expect(v.toJSON()).toEqual({
			schema: {
				email: { rules: ["string", "email"], optional: false, nullable: false },
				age: { rules: ["number"], optional: true, nullable: false },
			},
			refs: ["email", "age"],
		});
	});

	it("withMetaData validates the metadata before the payload", () => {
		const v = rune
			.withMetaData<{ tenantId: number }>((meta) => {
				if (typeof meta.tenantId !== "number") {
					throw new TypeError("tenantId is required");
				}
			})
			.create({ name: rules.string() });

		expect(
			v.validateResult({ name: "Ada" }, { meta: { tenantId: 3 } }).valid,
		).toBe(true);
		// Omitting metadata must be refused by the COMPILER (VineJS parity) — the
		// expect-error fails the build if that stops being true — and still guarded
		// at runtime for a JS caller.
		// @ts-expect-error withMetaData<T>() makes `meta` required
		expect(() => v.validateResult({ name: "Ada" })).toThrow(TypeError);
		// Wrong meta shape is a runtime failure too, loud rather than silent — a JS
		// caller gets no help from the compiler.
		expect(() =>
			// @ts-expect-error tenantId must be a number
			v.validateResult({ name: "Ada" }, { meta: { tenantId: "3" } }),
		).toThrow(TypeError);
	});

	it("createRule({ isAsync: true }) builds an awaited rule usable via .use()", async () => {
		// VineJS expresses async as an option on createRule; honouring it means
		// BUILDING the async rule, and `.use()` routing it to the awaited register.
		let ran = false;
		const slow = createRule(
			async (_v, _o, field) => {
				await Promise.resolve();
				ran = true;
				field.report("nope", "asyncViaUse");
			},
			{ isAsync: true },
		);

		const v = schema({ a: rules.string().use(slow()) });
		// Sync entry point must refuse rather than skip the awaited rule.
		expect(() => v.validateResult({ a: "x" })).toThrow(
			/validateAsync|validateResultAsync/,
		);
		const res = await v.validateResultAsync({ a: "x" });
		expect(ran).toBe(true);
		expect(res.errors[0]?.rule).toBe("asyncViaUse");
	});

	it("the one-shot helpers forward meta", () => {
		let seen: unknown;
		const spy = createRule((_v, _o, field) => {
			seen = field.meta.tenantId;
		});
		rune.validate({
			schema: { name: rune.string().use(spy()) },
			data: { name: "Ada" },
			meta: { tenantId: 7 },
		});
		expect(seen).toBe(7);
	});
});
