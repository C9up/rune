/**
 * Native validation loader — loads the Rust NAPI binary.
 *
 * @implements FR40
 */

import {
	loadNativeBinary,
	unavailableReason as vendorUnavailableReason,
} from "./vendor/nativeBinary.js";

/**
 * The engine's surface, as the Rust declares it.
 *
 * Derived from `./native/generated.js` — written by `pnpm build:napi-types`
 * from napi-derive's own `type-def` output — rather than restated here, where
 * nothing would notice a `pub fn` gaining a parameter or changing its return.
 */
type NativeRune = typeof import("./native/generated.js");

const attempt = loadNativeBinary<NativeRune>();
const native = attempt.loaded ? attempt.binary : undefined;
const loadError = attempt.loaded ? undefined : attempt.cause;

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
	if (loadError !== undefined) {
		return `failed to load (${loadError instanceof Error ? loadError.message : String(loadError)})`;
	}
	return vendorUnavailableReason();
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
