/**
 * Native validation loader — loads the Rust NAPI binary.
 *
 * @implements FR40
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { arch, platform } from "node:process";
import { fileURLToPath } from "node:url";

const require2 = createRequire(import.meta.url);
const __dirname2 = dirname(fileURLToPath(import.meta.url));

const platformMap: Record<string, string> = {
	"linux-x64": "linux-x64-gnu",
	"linux-arm64": "linux-arm64-gnu",
	"darwin-x64": "darwin-x64",
	"darwin-arm64": "darwin-arm64",
	"win32-x64": "win32-x64-msvc",
};

/**
 * The engine's surface, as the Rust declares it.
 *
 * Derived from `./native/generated.js` — written by `pnpm build:napi-types`
 * from napi-derive's own `type-def` output — rather than restated here, where
 * nothing would notice a `pub fn` gaining a parameter or changing its return.
 */
type NativeRune = typeof import("./native/generated.js");

let native: NativeRune | undefined;
let loadError: unknown;

try {
	const suffix = platformMap[`${platform}-${arch}`];
	if (suffix) {
		native = require2(join(__dirname2, `../index.${suffix}.node`));
	}
} catch (e) {
	loadError = e;
}

/**
 * Validate data via the Rust NAPI engine.
 */
export function validateNative(requestJson: string): {
	valid: boolean;
	errors: Array<{ field: string; rule: string; message: string }>;
	data?: Record<string, unknown>;
} {
	if (!native) {
		throw new Error(
			`[E_RUNE_NAPI_NOT_FOUND] Rust validation engine not available: ${loadError ?? "binary not found"}`,
		);
	}
	const result = JSON.parse(native.validate(requestJson));
	if (typeof result.valid !== "boolean" || !Array.isArray(result.errors)) {
		throw new Error(
			`[E_RUNE_NAPI_INVALID_RESPONSE] Rust engine returned unexpected shape: ${JSON.stringify(result)}`,
		);
	}
	return result;
}

export function isNativeAvailable(): boolean {
	return native !== undefined;
}

/** Why the engine could not be loaded, phrased for whoever has to fix it. */
function unavailableReason(): string {
	const target = `${platform}-${arch}`;
	if (loadError !== undefined) {
		return `failed to load (${loadError instanceof Error ? loadError.message : String(loadError)})`;
	}
	return platformMap[target] !== undefined
		? "binary not found"
		: `no prebuilt binary for ${target}`;
}

/** Raised when a schema needs the Rust engine and it is not there. */
export class RuneNativeRequiredError extends Error {
	readonly code = "E_RUNE_NAPI_REQUIRED" as const;
	constructor() {
		super(
			`[E_RUNE_NAPI_REQUIRED] The Rust validation engine is required but not loaded — ${unavailableReason()}.\n` +
				"Install the prebuilt binary for this platform, or build it with `pnpm build:napi`.",
		);
		this.name = "RuneNativeRequiredError";
	}
}

/**
 * Refuse to validate without the native engine.
 *
 * There is a TypeScript validator, and it used to take over silently with a
 * one-time warning. That made a schema's verdict depend on whether a prebuilt
 * binary happened to load: two deployments of the same code could disagree on
 * whether a payload is valid, and the one that fell back lost the reason to
 * have Rust at all. A schema the engine can run is now run BY the engine or
 * not at all.
 *
 * The TypeScript path stays for what the engine genuinely cannot do — custom
 * rules, a translator, a messages provider — where it is the only
 * implementation, not a second one.
 */
export function assertNativeAvailable(): void {
	if (native === undefined) throw new RuneNativeRequiredError();
}
