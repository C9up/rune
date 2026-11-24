/**
 * Native validation loader.
 *
 * Loads the local build (`index.<suffix>.node` at the package root, written by
 * `scripts/copy-napi.mjs`) when there is one, else the platform package
 * `@c9up/rune-<suffix>` the package manager installed as an optional
 * dependency. A refusal says what to do in its message; the load error is its
 * `cause`.
 *
 * @implements FR40
 */

import { arch, platform } from "node:process";
import {
	E_RUNE_NAPI_INVALID_RESPONSE,
	E_RUNE_NAPI_NOT_FOUND,
	E_RUNE_NAPI_REQUEST_REFUSED,
	E_RUNE_NAPI_REQUIRED,
} from "./errors.js";
import {
	hasFunctions,
	loadNativeBinary,
	muslHint,
	supportedTargets,
} from "./vendor/nativeBinary.js";

/**
 * The npm name the platform packages derive from: `@c9up/rune-<suffix>`,
 * one per target, each an optional dependency pinned to this version.
 */
const PACKAGE_NAME = "@c9up/rune";

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

const attempt = loadNativeBinary(isNativeRune, NATIVE_CALLS, {
	packageName: PACKAGE_NAME,
});

/**
 * What to do about a missing engine, phrased for whoever has to fix it.
 *
 * An application installs the platform package; a checkout of rune builds
 * the local binary. The load error itself is not in here: it names paths on
 * the host, so it travels as the refusal's `cause` instead of its message.
 */
function remedy(
	suffix: string | undefined,
	platformPackage: string | undefined,
): string {
	if (suffix === undefined) {
		return `no prebuilt binary for ${platform}-${arch}; rune ships one for ${supportedTargets().join(", ")}.`;
	}
	if (platformPackage === undefined) {
		return `index.${suffix}.node failed to load. Rebuild it: cd packages/rune && pnpm build:napi`;
	}
	return (
		`install ${platformPackage} at the exact version of ${PACKAGE_NAME}: it is the optional dependency that carries the ${suffix} binary, ` +
		"and an install that omits optional dependencies skips it. " +
		`In a checkout of rune, build it instead: pnpm build:napi.${muslHint()}`
	);
}

/** The options of a refusal: the load error as its cause, when there is one. */
function causeOf(cause: unknown): { cause: unknown } | undefined {
	return cause === undefined ? undefined : { cause };
}

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
	if (!attempt.loaded) {
		throw new E_RUNE_NAPI_NOT_FOUND(
			[remedy(attempt.suffix, attempt.platformPackage)],
			causeOf(attempt.cause),
		);
	}
	let response: string;
	try {
		response = attempt.binary.validate(requestJson);
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
	return attempt.loaded;
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
	if (!attempt.loaded)
		throw new E_RUNE_NAPI_REQUIRED(
			[remedy(attempt.suffix, attempt.platformPackage)],
			causeOf(attempt.cause),
		);
}
