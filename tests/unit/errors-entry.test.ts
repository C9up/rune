import { Exception } from "@c9up/flare";
import { describe, expect, it } from "vitest";
import { errors } from "../../src/index.js";

describe("the errors namespace", () => {
	it("is exported from the entry, one flare Exception per code", () => {
		const invalid = new errors.E_VALIDATION_ERROR([
			{ field: "name", rule: "required", message: "required" },
		]);
		expect(invalid).toBeInstanceOf(Exception);
		expect(invalid.code).toBe("E_VALIDATION_ERROR");
		expect(invalid.status).toBe(422);
		expect(invalid.message).toBe("Validation failure");

		const size = new errors.E_RUNE_INVALID_SIZE("2 bananas");
		expect(size).toBeInstanceOf(Exception);
		expect(size.code).toBe("E_RUNE_INVALID_SIZE");
		expect(size.status).toBe(500);
		expect(size.help).toBe('Use a byte count, or "2mb" / "512kb" / "1gb".');
	});
});
