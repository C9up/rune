/**
 * Rune errors, one per code.
 *
 * `E_VALIDATION_ERROR` keeps upstream's identifier, so an application catches
 * it as it does upstream:
 *
 *   import { errors } from '@c9up/rune'
 *   if (error instanceof errors.E_VALIDATION_ERROR) { ... }
 *
 * Every other code carries the `E_RUNE_` namespace. An advice to fix the
 * error is on its `help`.
 */
import { createError, Exception } from "@c9up/flare";

/**
 * A single validation failure in an {@link E_VALIDATION_ERROR} — mirrors the
 * upstream `SimpleErrorReporter` node shape `{ message, rule, field, index?, meta? }`.
 */
export interface RuneErrorNode {
	/** Human-readable (already interpolated) error message. */
	message: string;
	/** The rule that failed, e.g. `required`, `minLength`, `email`. */
	rule: string;
	/** Dotted field path, e.g. `user.email` or `tags.0`. */
	field: string;
	/** Array index when the field is an array item (upstream parity). */
	index?: number;
	/** Rule metadata carried for reporters/i18n (e.g. `{ min: 3 }`). */
	meta?: Record<string, unknown>;
}

/**
 * Thrown by `validate()` when the data does not pass. Carries the structured
 * `messages` array and the HTTP status 422, so web layers can render it
 * directly, matching upstream.
 */
export class E_VALIDATION_ERROR extends Exception {
	static override code = "E_VALIDATION_ERROR";
	static override status = 422;
	static override message = "Validation failure";

	/** Structured, per-field validation messages. */
	readonly messages: RuneErrorNode[];

	constructor(messages: RuneErrorNode[], options?: ErrorOptions) {
		super(undefined, options);
		this.messages = messages;
	}
}

/** A rule's verdict would arrive after validation ended. */
export class E_RUNE_ASYNC_RULE_NOT_AWAITED extends Exception {
	static override code = "E_RUNE_ASYNC_RULE_NOT_AWAITED";

	constructor(message: string, help?: string) {
		super(message);
		if (help !== undefined) this.help = help;
	}
}

/** An `errorReporter` factory did not return a reporter. */
export class E_RUNE_INVALID_ERROR_REPORTER extends Exception {
	static override code = "E_RUNE_INVALID_ERROR_REPORTER";
	static override message =
		"errorReporter takes no argument but did not return a reporter ({ report, createError }).";
	static override help =
		"A factory returns a reporter; an observer must declare its parameter without a default: (error) => …";
}

/** JSON Schema was asked for in a draft rune does not emit. */
export class E_RUNE_UNSUPPORTED_JSON_SCHEMA_TARGET extends Exception {
	static override code = "E_RUNE_UNSUPPORTED_JSON_SCHEMA_TARGET";

	constructor(target: string, supported: string) {
		super(`rune emits ${supported} JSON Schema, not '${target}'.`);
		this.help = `Ask for '${supported}', or omit the target to get it.`;
	}
}

/** `unique()` or `exists()` with a table, and no database resolver bound. */
export class E_RUNE_NO_DATABASE_RESOLVER extends Exception {
	static override code = "E_RUNE_NO_DATABASE_RESOLVER";
	static override help =
		"Call bindDatabase(resolver) once at boot, or pass a callback.";

	constructor(kind: string) {
		super(`rules.${kind}({ table }) needs a database resolver.`);
	}
}

/** `file()` was given a size it cannot read. */
export class E_RUNE_INVALID_SIZE extends Exception {
	static override code = "E_RUNE_INVALID_SIZE";
	static override help = 'Use a byte count, or "2mb" / "512kb" / "1gb".';

	constructor(size: unknown) {
		super(`file(): cannot read size '${String(size)}'.`);
	}
}

/** JSON Schema was asked for a validator's output. */
export class E_RUNE_NO_OUTPUT_SCHEMA extends Exception {
	static override code = "E_RUNE_NO_OUTPUT_SCHEMA";
	static override message =
		"rune cannot describe a validator's OUTPUT as JSON Schema: a transform may produce anything.";
	static override help =
		"Use `~standard.jsonSchema.input()` for the shape rune accepts.";
}

/** A shape operation (`merge`, `pick`, `omit`, `partial`) on something that is not an object. */
export class E_RUNE_NOT_AN_OBJECT extends Exception {
	static override code = "E_RUNE_NOT_AN_OBJECT";

	constructor(message: string, help: string) {
		super(message);
		this.help = help;
	}
}

/** `partial()` on a shape it cannot relax. */
export class E_RUNE_PARTIAL_NOT_APPLICABLE extends Exception {
	static override code = "E_RUNE_PARTIAL_NOT_APPLICABLE";
	static override message =
		"partial() cannot relax a shape that has groups or allowUnknownProperties().";
	static override help =
		"Relax the properties before grouping them, or list the keys partial() should touch.";
}

/** `activeUrl()` with no host resolver bound. */
export class E_RUNE_NO_HOST_RESOLVER extends Exception {
	static override code = "E_RUNE_NO_HOST_RESOLVER";
	static override message = "activeUrl() needs a host resolver.";
	static override help = "Call bindHostResolver(resolver) once at boot.";
}

/** `mobile()` was given a locale it has no numbering plan for. */
export class E_RUNE_UNSUPPORTED_LOCALE extends Exception {
	static override code = "E_RUNE_UNSUPPORTED_LOCALE";

	constructor(locale: string, supported: readonly string[]) {
		super(`mobile(): no numbering plan for locale '${locale}'.`);
		this.help = `Supported: ${supported.join(", ")}. Omit the locale for E.164, or use .regex().`;
	}
}

/** A country rule (`postalCode`, `vat`, `passport`) was given a country it does not know. */
export class E_RUNE_UNSUPPORTED_COUNTRY extends Exception {
	static override code = "E_RUNE_UNSUPPORTED_COUNTRY";

	/** `rule` names the method, `what` what it lacks ("pattern", "rule"). */
	constructor(
		rule: string,
		what: string,
		country: string,
		supported: readonly string[],
	) {
		super(`${rule}(): no ${what} for country '${country}'.`);
		this.help = `Supported: ${supported.join(", ")}. Use .regex() for others.`;
	}
}

/** `use()` or `useAsync()` was given a rule factory instead of a compiled rule. */
export class E_RUNE_INVALID_RULE extends Exception {
	static override code = "E_RUNE_INVALID_RULE";

	constructor(message: string, help: string) {
		super(message);
		this.help = help;
	}
}

/** `message()` was called before any rule. */
export const E_RUNE_NO_RULE = createError(
	"message() must be called after a rule",
	"E_RUNE_NO_RULE",
);

/** `unionOfTypes()` has a branch that declares no type. */
export class E_RUNE_NO_TYPE_RULE extends Exception {
	static override code = "E_RUNE_NO_TYPE_RULE";
	static override message =
		"unionOfTypes() needs every branch to declare a type (string/number/…).";
	static override help = "Use union([...]) for predicate-based branches.";
}

/** `unionOfTypes()` has two branches of the same type. */
export class E_RUNE_DUPLICATE_UNION_TYPE extends Exception {
	static override code = "E_RUNE_DUPLICATE_UNION_TYPE";
	static override help =
		"Give each branch a distinct type, or use union([...]).";

	constructor(name: string) {
		super(
			`unionOfTypes() got two '${name}' branches — the second can never be reached.`,
		);
	}
}

/** A validator built with `withMetaData()` was called without `{ meta }`. */
export const E_RUNE_META_REQUIRED = createError(
	"This validator was built with withMetaData(), so every call must pass { meta }.",
	"E_RUNE_META_REQUIRED",
);

/** A file-type check was pointed at something that is not a regular file. */
export const E_RUNE_NOT_A_REGULAR_FILE = createError<[string]>(
	"'%s' is not a regular file, so it is not an upload.",
	"E_RUNE_NOT_A_REGULAR_FILE",
);

/**
 * The Rust validation engine could not be loaded. The value is what to do
 * about it; the load error is the `cause`.
 */
export const E_RUNE_NAPI_NOT_FOUND = createError<[string]>(
	"Rust validation engine not available.\n  Fix: %s",
	"E_RUNE_NAPI_NOT_FOUND",
);

/**
 * The Rust validation engine refused the request. Its own wording stays out
 * of the message, since it quotes positions inside the payload: it is the
 * `help`, and the engine's error is the `cause`.
 */
export class E_RUNE_NAPI_REQUEST_REFUSED extends Exception {
	static override code = "E_RUNE_NAPI_REQUEST_REFUSED";
	static override message = "The Rust validation engine refused the request.";

	constructor(cause: unknown) {
		super(undefined, { cause });
		this.help =
			cause instanceof Error
				? cause.message
				: "No reason was given by the engine.";
	}
}

/** The Rust validation engine answered with a shape rune does not read. */
export const E_RUNE_NAPI_INVALID_RESPONSE = createError(
	"The Rust validation engine returned an unexpected shape.",
	"E_RUNE_NAPI_INVALID_RESPONSE",
);

/**
 * A schema needs the Rust engine and it is not there. The value is what to do
 * about it; the load error is the `cause`.
 */
export const E_RUNE_NAPI_REQUIRED = createError<[string]>(
	"The Rust validation engine is required but not loaded.\n  Fix: %s",
	"E_RUNE_NAPI_REQUIRED",
);

/** `normalizeUrl()` was given both `forceHttp` and `forceHttps`. */
export const E_RUNE_CONFLICTING_URL_OPTIONS = createError(
	"normalizeUrl(): forceHttp and forceHttps cannot be used together.",
	"E_RUNE_CONFLICTING_URL_OPTIONS",
);
