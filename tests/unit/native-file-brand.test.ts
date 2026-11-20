import { describe, expect, it } from "vitest";
import { create, rules } from "../../src/index.js";

/**
 * `nativeFile()` is for the platform `File` object, as upstream: a JSON body
 * that LOOKS like a file (a numeric `size`, a client-chosen `name`/`type`) is
 * not one, and the handler would crash on `arrayBuffer()` or trust the forged
 * metadata.
 */
describe("rune > nativeFile() requires a real File", () => {
	it("refuses a JSON-parsed lookalike, whatever the options", async () => {
		const forged: unknown = JSON.parse(
			'{"avatar":{"size":12,"type":"image/png","name":"a.png"}}',
		);
		for (const chain of [
			rules.nativeFile(),
			rules.nativeFile({ maxSize: "1mb" }),
			rules.nativeFile().minSize(1),
		]) {
			const [error] = await create({ avatar: chain }).tryValidate(forged);
			expect(error?.messages).toEqual([
				expect.objectContaining({ field: "avatar", rule: "nativeFile" }),
			]);
		}
	});

	it("accepts a File", async () => {
		const file = new File([new Uint8Array(12)], "a.png", {
			type: "image/png",
		});
		const out = await create({
			avatar: rules.nativeFile({ maxSize: "1mb" }),
		}).validate({ avatar: file });
		expect(out.avatar).toBe(file);
	});
});
