import { describe, expect, it } from "vitest";
import rune, { create, rules } from "../../src/index.js";

/**
 * `allowUnknownProperties()` keeps the keys the shape does NOT declare. A
 * declared key only ever reaches the output under its output name, with its
 * validated value: the raw input of a declared field must never survive beside
 * it (an `escape()` or a `trim()` would be bypassed by whoever persists the
 * payload with snake_case columns).
 */
describe("rune > allowUnknownProperties() never copies a declared key", () => {
	it("toCamelCase() nested: the snake_case raw value is gone", async () => {
		const v = create({
			profile: rune
				.object({
					user_bio: rules.string().escape(),
					display_name: rules.string().trim(),
				})
				.toCamelCase()
				.allowUnknownProperties(),
		});
		const out = await v.validate({
			profile: {
				user_bio: "<script>alert(1)</script>",
				display_name: "  bob  ",
				extra_key: 1,
			},
		});
		expect(out).toEqual({
			profile: {
				userBio: "&lt;script&gt;alert(1)&lt;&#x2F;script&gt;",
				displayName: "bob",
				// Unknown keys are moved as they are, as upstream does.
				extra_key: 1,
			},
		});
	});

	it("toCamelCase() at the root: same guarantee", async () => {
		const v = create(
			rune
				.object({ user_bio: rules.string().escape() })
				.toCamelCase()
				.allowUnknownProperties(),
		);
		expect(await v.validate({ user_bio: "<b>x</b>" })).toEqual({
			userBio: "&lt;b&gt;x&lt;&#x2F;b&gt;",
		});
	});

	it("a declared field whose transform yields undefined is absent, not raw", async () => {
		const v = create({
			p: rune
				.object({
					note: rules
						.string()
						.optional()
						.transform(() => undefined),
				})
				.allowUnknownProperties(),
		});
		expect(await v.validate({ p: { note: "<raw>" } })).toEqual({ p: {} });
	});

	it("an unknown key cannot shadow a declared field's output name", async () => {
		const v = create({
			p: rune
				.object({ user_bio: rules.string().trim() })
				.toCamelCase()
				.allowUnknownProperties(),
		});
		expect(
			await v.validate({ p: { user_bio: "  ok  ", userBio: "  forged  " } }),
		).toEqual({ p: { userBio: "ok" } });
	});

	it("a key declared by a group branch that did not match is not copied raw", async () => {
		const v = create({
			p: rune
				.object({ type: rules.string() })
				.merge(
					rune.group([
						rune.group.if((d) => d.type === "a", {
							secret: rules.string().trim(),
						}),
						rune.group.else({ other: rules.string().optional() }),
					]),
				)
				.allowUnknownProperties(),
		});
		// `secret` belongs to the shape (branch "a"); with branch "else" chosen it
		// is a declared name all the same and is dropped, as upstream does.
		expect(
			await v.validate({ p: { type: "b", secret: "  raw  ", extra: 1 } }),
		).toEqual({ p: { type: "b", extra: 1 } });
	});
});
