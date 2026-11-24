/**
 * A guarded `union` and a `group` are decided by their predicates. When no
 * predicate answers true and there is no `else` branch, the value is refused
 * (`union` / `unionGroup`) unless an `otherwise()` callback decides instead.
 */
import { describe, expect, it } from "vitest";
import rune, { SimpleMessagesProvider } from "../../src/index.js";

const adminShape = rune.object({ name: rune.string(), role: rune.string() });
const userShape = rune.object({ name: rune.string() });
const payload = { user: { name: "eve", role: "superadmin" } };

describe("rune > a guarded union with no matching branch", () => {
	it("is refused, and no guarded branch validates the value", async () => {
		const update = rune.create({
			user: rune.union([
				rune.union.if(
					(_value, field) => field.meta.actor === "admin",
					adminShape,
				),
				rune.union.if(
					(_value, field) => field.meta.actor === "user",
					userShape,
				),
			]),
		});
		// The predicate picks the branch: a user cannot set `role`.
		expect(update.validateResult(payload, { meta: { actor: "user" } })).toEqual(
			{ valid: true, errors: [], data: { user: { name: "eve" } } },
		);
		expect(
			update.validateResult(payload, { meta: { actor: "admin" } }).data,
		).toEqual(payload);

		const refused = update.validateResult(payload, {
			meta: { actor: "guest" },
		});
		expect(refused.valid).toBe(false);
		expect(refused.errors).toEqual([
			{
				field: "user",
				rule: "union",
				message: "Invalid value provided for user field",
			},
		]);
		const [error] = await update.tryValidate(payload, {
			meta: { actor: "guest" },
		});
		expect(error?.messages.map((node) => node.rule)).toEqual(["union"]);
	});

	it("never runs a branch whose predicate answered false", () => {
		let runs = 0;
		const counted = rune.createRule(() => {
			runs++;
		});
		const schema = rune.create({
			value: rune.union([
				rune.union.if(() => false, rune.string().use(counted())),
				rune.union.if(() => false, rune.number().use(counted())),
			]),
		});
		expect(schema.validateResult({ value: "a" }).valid).toBe(false);
		expect(runs).toBe(0);
	});

	it("falls back to the else branch when there is one", () => {
		const schema = rune.create({
			user: rune.union([
				rune.union.if(
					(_value, field) => field.meta.actor === "admin",
					adminShape,
				),
				rune.union.else(userShape),
			]),
		});
		expect(
			schema.validateResult(payload, { meta: { actor: "guest" } }).data,
		).toEqual({ user: { name: "eve" } });
	});

	it("hands the case to the otherwise() callback", () => {
		const guard = () => rune.union([rune.union.if(() => false, rune.string())]);
		const reporting = rune.create({
			value: guard().otherwise((_value, field) => {
				field.report("Pick a known shape", "shape");
			}),
		});
		expect(reporting.validateResult({ value: "a" }).errors).toEqual([
			{ field: "value", rule: "shape", message: "Pick a known shape" },
		]);
		// A callback that reports nothing accepts the value as it is.
		const silent = rune.create({ value: guard().otherwise(() => {}) });
		expect(silent.validateResult({ value: "a" })).toEqual({
			valid: true,
			errors: [],
			data: { value: "a" },
		});
	});

	it("refuses a value no unionOfTypes branch takes", () => {
		const schema = rune.create({
			id: rune.unionOfTypes([rune.string(), rune.number({ strict: true })]),
		});
		expect(schema.validateResult({ id: 4 }).valid).toBe(true);
		expect(
			schema.validateResult({ id: true }).errors.map((error) => error.rule),
		).toEqual(["union"]);
	});

	it("keeps first-that-validates for a union of bare chains", () => {
		const schema = rune.create({
			id: rune.union([rune.string().minLength(5), rune.number()]),
		});
		expect(schema.validateResult({ id: "abcdef" }).valid).toBe(true);
		expect(schema.validateResult({ id: "12" }).data).toEqual({ id: 12 });
		expect(
			schema.validateResult({ id: "ab" }).errors.map((error) => error.rule),
		).toEqual(["union"]);
	});
});

describe("rune > a group with no matching branch", () => {
	const branches = () => [
		rune.group.if((data) => data.type === "stripe", {
			account_id: rune.string(),
		}),
		rune.group.if((data) => data.type === "paypal", {
			email: rune.string().email(),
		}),
	];

	it("refuses the object with unionGroup", async () => {
		const payment = rune.create(
			rune.object({ type: rune.string() }).merge(rune.group(branches())),
		);
		expect(payment.validateResult({ type: "stripe" }).valid).toBe(false);
		expect(
			payment.validateResult({ type: "stripe", account_id: "acct_1" }).valid,
		).toBe(true);
		expect(payment.validateResult({ type: "none" })).toEqual({
			valid: false,
			errors: [
				{
					field: "",
					rule: "unionGroup",
					message: "Invalid value provided for data field",
				},
			],
		});
		await expect(payment.validate({ type: "none" })).rejects.toMatchObject({
			code: "E_VALIDATION_ERROR",
		});
	});

	it("reports on the nested object, after its own properties", () => {
		const order = rune.create({
			payment: rune
				.object({ type: rune.string(), amount: rune.number() })
				.merge(rune.group(branches())),
		});
		const result = order.validateResult({ payment: { type: "none" } });
		expect(result.errors.map((error) => [error.field, error.rule])).toEqual([
			["payment.amount", "required"],
			["payment", "unionGroup"],
		]);
	});

	it("goes through the messages provider", () => {
		const payment = rune.create(
			rune.object({ type: rune.string() }).merge(rune.group(branches())),
		);
		const result = payment.validateResult(
			{ type: "none" },
			{
				messagesProvider: new SimpleMessagesProvider({
					unionGroup: "Unknown payment type",
				}),
			},
		);
		expect(result.errors[0]?.message).toBe("Unknown payment type");
	});

	it("takes the else branch when there is one", () => {
		const payment = rune.create(
			rune
				.object({ type: rune.string() })
				.merge(
					rune.group([
						...branches(),
						rune.group.else({ reference: rune.string() }),
					]),
				),
		);
		expect(payment.validateResult({ type: "none" }).valid).toBe(false);
		expect(
			payment.validateResult({ type: "none", reference: "r-1" }).data,
		).toEqual({ type: "none", reference: "r-1" });
	});

	it("hands the case to the otherwise() callback", () => {
		const reporting = rune.create(
			rune.object({ type: rune.string() }).merge(
				rune.group(branches()).otherwise((_value, field) => {
					field.report("Unknown payment type", "paymentType");
				}),
			),
		);
		expect(reporting.validateResult({ type: "none" }).errors).toEqual([
			{ field: "", rule: "paymentType", message: "Unknown payment type" },
		]);
		const silent = rune.create(
			rune
				.object({ type: rune.string() })
				.merge(rune.group(branches()).otherwise(() => {})),
		);
		expect(silent.validateResult({ type: "none" })).toEqual({
			valid: true,
			errors: [],
			data: { type: "none" },
		});
	});
});
