/**
 * RuneError — structured error for Rune validation.
 */
export class RuneError extends Error {
	readonly code: string;
	readonly hint?: string;

	constructor(code: string, message: string, options?: { hint?: string }) {
		super(message);
		this.name = "RuneError";
		// One namespace, one prefix. `E_` is what every framework code carries,
		// and the package name after it says which package raised it — without
		// it, `E_FORBIDDEN` would mean three different things across the
		// ecosystem and an application could not tell them apart. A code that
		// already starts with `E_` is passed through untouched: that is how the
		// AdonisJS identifiers keep the exact spelling a consumer branches on.
		this.code = code.startsWith("E_") ? code : `E_RUNE_${code}`;
		this.hint = options?.hint;
	}
}

/**
 * A single validation failure in a {@link RuneValidationError} — mirrors the
 * VineJS `SimpleErrorReporter` node shape `{ message, rule, field, index?, meta? }`.
 */
export interface RuneErrorNode {
	/** Human-readable (already interpolated) error message. */
	message: string;
	/** The rule that failed, e.g. `required`, `minLength`, `email`. */
	rule: string;
	/** Dotted field path, e.g. `user.email` or `tags.0`. */
	field: string;
	/** Array index when the field is an array item (VineJS parity). */
	index?: number;
	/** Rule metadata carried for reporters/i18n (e.g. `{ min: 3 }`). */
	meta?: Record<string, unknown>;
}

/**
 * Thrown by {@link ValidationSchema.validateOrThrow} — VineJS's
 * `E_VALIDATION_ERROR`. Carries the structured `messages` array and an HTTP
 * `status` (422) so web layers can render it directly, matching AdonisJS/VineJS.
 */
export class RuneValidationError extends Error {
	/** Internal error code for programmatic handling (VineJS parity). */
	readonly code = "E_VALIDATION_ERROR";
	/** HTTP status for the failure (422 Unprocessable Entity). */
	readonly status = 422;
	/** Structured, per-field validation messages. */
	readonly messages: RuneErrorNode[];

	constructor(messages: RuneErrorNode[], options?: ErrorOptions) {
		super("Validation failure", options);
		this.name = "RuneValidationError";
		this.messages = messages;
		if ("captureStackTrace" in Error) {
			Error.captureStackTrace(this, RuneValidationError);
		}
	}

	get [Symbol.toStringTag](): string {
		return this.name;
	}

	override toString(): string {
		return `${this.name} [${this.code}]: ${this.message}`;
	}
}

/**
 * VineJS-compatible alias. Adonis/Vine code catches on the error's NAME:
 *
 *   import { errors } from '@c9up/rune'
 *   if (error instanceof errors.E_VALIDATION_ERROR) { ... }
 *
 * Without this binding the namespace exists but the member does not, and a
 * copy-pasted Adonis handler silently never matches.
 */
export const E_VALIDATION_ERROR = RuneValidationError;
