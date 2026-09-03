/**
 * A `__proto__` key must not survive validation.
 *
 * Dropping undeclared keys is what makes a validated payload safe to hand
 * straight to a mass assignment — that is the guarantee the object rules are
 * built around. Two paths keep keys the schema never named: the
 * `allowUnknownProperties()` opt-in, and `record()`, whose keys are data.
 *
 * Neither replaced rune's own prototype (both copy by spread), but both let
 * `__proto__` through as an own property, and the consumer is the one who pays:
 * `Object.assign(model, validated)` assigns through the inherited setter and
 * replaces the target's prototype. So the payload was not safe to hand to the
 * one thing it was promised to be safe for.
 */

import { describe, expect, it } from "vitest";
import { rules, schema } from "../../src/index.js";

/** JSON.parse is the only way to get a real own `__proto__` key. */
const parse = (json: string): unknown => JSON.parse(json);

describe("rune > a __proto__ key", () => {
	it("is dropped from kept unknown properties", () => {
		const result = schema({
			user: rules.object({ name: rules.string() }).allowUnknownProperties(),
		}).validateResult(
			parse('{"user":{"name":"a","keep":1,"__proto__":{"isAdmin":true}}}'),
		);
		const user = (result.data as Record<string, unknown>).user as object;

		expect(Object.hasOwn(user, "__proto__")).toBe(false);
		// The opt-in still does its job for every other key.
		expect(user).toMatchObject({ name: "a", keep: 1 });
	});

	it("is dropped from a record's keys", () => {
		const result = schema({
			m: rules.record(rules.object({ v: rules.string() })),
		}).validateResult(parse('{"m":{"ok":{"v":"y"},"__proto__":{"v":"x"}}}'));
		const m = (result.data as Record<string, unknown>).m as object;

		expect(Object.hasOwn(m, "__proto__")).toBe(false);
		expect(Object.keys(m)).toEqual(["ok"]);
	});

	// The point of the whole exercise: what the consumer does next is safe.
	it("leaves a payload that cannot poison the object it is assigned to", () => {
		const result = schema({
			user: rules.object({ name: rules.string() }).allowUnknownProperties(),
		}).validateResult(
			parse('{"user":{"name":"a","__proto__":{"isAdmin":true}}}'),
		);

		const model: Record<string, unknown> = {};
		Object.assign(model, (result.data as Record<string, unknown>).user);

		expect(Object.getPrototypeOf(model)).toBe(Object.prototype);
		expect(model.isAdmin).toBeUndefined();
		expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
	});
});
