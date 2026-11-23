/**
 * Native validation loader — loads the Rust NAPI binary.
 *
 * @implements FR40
 */

import {
	E_RUNE_NAPI_INVALID_RESPONSE,
	E_RUNE_NAPI_NOT_FOUND,
	E_RUNE_NAPI_REQUEST_REFUSED,
	E_RUNE_NAPI_REQUIRED,
} from "./errors.js";
import {
	hasFunctions,
	loadNativeBinary,
	unavailableReason as vendorUnavailableReason,
} from "./vendor/nativeBinary.js";

/**
 * What this package calls on the engine, typed as the Rust declares it.
 *
 * Derived from `./native/generated.js` — written by `pnpm build:napi-types`
 * from napi-derive's own `type-def` output — rather than restated here, where
 * nothing would notice a `pub fn` gaining a parameter or changing its return.
 */
const NATIVE_CALLS = ["validate"] as const;

type NativeRune = Pick<
	typeof import("./native/generated.js"),
	(typeof NATIVE_CALLS)[number]
>;

/** What the package calls, checked at load: a stale binary loads just as well. */
function isNativeRune(value: unknown): value is NativeRune {
	return hasFunctions(value, NATIVE_CALLS);
}

const attempt = loadNativeBinary(isNativeRune, NATIVE_CALLS);
const native = attempt.loaded ? attempt.binary : undefined;
const loadError = attempt.loaded ? undefined : attempt.cause;

/** One failure as the engine reports it. */
export interface NativeError {
	field: string;
	rule: string;
	message: string;
	/** Position of the failing rule in the field's rule list. */
	ruleIndex?: number;
}

/**
 * Validate data via the Rust NAPI engine.
 */
export function validateNative(requestJson: string): {
	valid: boolean;
	errors: NativeError[];
	data?: Record<string, unknown>;
} {
	if (!native) {
		throw new E_RUNE_NAPI_NOT_FOUND([String(loadError ?? "binary not found")], {
			cause: loadError,
		});
	}
	let response: string;
	try {
		response = native.validate(requestJson);
	} catch (cause) {
		throw new E_RUNE_NAPI_REQUEST_REFUSED(cause);
	}
	const result = JSON.parse(response);
	if (typeof result.valid !== "boolean" || !Array.isArray(result.errors)) {
		throw new E_RUNE_NAPI_INVALID_RESPONSE();
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
	if (native === undefined)
		throw new E_RUNE_NAPI_REQUIRED([unavailableReason()]);
}
