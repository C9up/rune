/**
 * SimpleMessagesProvider — VineJS-compatible message lookup.
 *
 * Resolves an error message for a `(rule, field)` pair using a `'field.rule'`
 * → template map, human-readable field labels, wildcard (`*`) segments for
 * array items, and mustache `{{ field }}` interpolation. Mirrors
 * `@vinejs/vine`'s provider so validators authored against Vine's message
 * conventions behave identically here.
 */

/** Rule name → message template, e.g. `{ required: 'The {{ field }} is required' }`. */
export type ValidationMessages = Record<string, string>;
/** Field path → human label, e.g. `{ 'user.email': 'Email address' }`. */
export type ValidationFields = Record<string, string>;

/** Interpolation values handed to a message template. */
export type MessageArgs = Record<string, unknown>;

/**
 * What a provider reads off the field it is asked about.
 *
 * Structural on purpose: a provider only ever needs the path, the wildcard
 * path and the last segment, so it does not have to import the whole
 * `FieldContext` — and rune's own `FieldContext` satisfies this shape.
 */
export interface MessageFieldContext {
	/** Last path segment. A NUMBER for an array item (`tags.0` → `0`). */
	name: string | number;
	/** Dotted path with numeric segments replaced by `*` (`tags.*.name`). */
	wildCardPath: string;
	/** The full dotted path — `user.email`, `tags.0.label`. */
	getFieldPath(): string;
}

/** Narrow to a plain record so dotted-path interpolation can index it. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Contract any messages provider must satisfy — a single `getMessage` lookup.
 * Keeping it an interface lets consumers swap in their own (e.g. i18n-backed)
 * provider without importing the concrete class.
 */
export interface MessagesProviderContract {
	getMessage(
		rawMessage: string,
		rule: string,
		field: MessageFieldContext,
		args?: MessageArgs,
	): string;
}

/**
 * Replace a dotted field path's numeric segments with `*` so array items share
 * a single wildcard message key — `tags.0.name` → `tags.*.name` (VineJS parity).
 */
export function toWildcardPath(field: string): string {
	return field
		.split(".")
		.map((segment) => (/^\d+$/.test(segment) ? "*" : segment))
		.join(".");
}

export class SimpleMessagesProvider implements MessagesProviderContract {
	readonly #messages: ValidationMessages;
	readonly #fields: ValidationFields;

	constructor(messages: ValidationMessages, fields?: ValidationFields) {
		this.#messages = messages;
		this.#fields = fields ?? {};
	}

	/** Mustache-style `{{ token }}` interpolation with dotted-path lookup. */
	#interpolate(message: string, data: MessageArgs): string {
		if (!message.includes("{{")) {
			return message;
		}
		return message.replace(/{{(.*?)}}/g, (_match, rawKey: string) => {
			const tokens = rawKey.trim().split(".");
			let output: unknown = data;
			for (const token of tokens) {
				if (!isRecord(output)) {
					return "";
				}
				output = Object.hasOwn(output, token) ? output[token] : undefined;
			}
			return output === undefined || output === null ? "" : String(output);
		});
	}

	/**
	 * Resolve a message. Priority (VineJS order):
	 *   1. field-specific   `user.email.required`
	 *   2. wildcard path     `*.required` / `tags.*.minLength`
	 *   3. generic rule      `required`
	 *   4. raw rule message  (fallback)
	 */
	getMessage(
		rawMessage: string,
		rule: string,
		field: MessageFieldContext,
		args?: MessageArgs,
	): string {
		const path = field.getFieldPath();
		// Three steps, not one: a label keyed by the bare NAME covers every path
		// that ends in it, so `{ link: 'some link' }` labels `auth.profile.link`
		// without the caller having to write the whole path out.
		const fieldName =
			this.#fields[path] || this.#fields[String(field.name)] || field.name;
		const data: MessageArgs = { field: fieldName, ...args };

		const fieldMessage = this.#messages[`${path}.${rule}`];
		if (fieldMessage !== undefined) {
			return this.#interpolate(fieldMessage, data);
		}

		const wildcardMessage = this.#messages[`${field.wildCardPath}.${rule}`];
		if (wildcardMessage !== undefined) {
			return this.#interpolate(wildcardMessage, data);
		}

		const ruleMessage = this.#messages[rule];
		if (ruleMessage !== undefined) {
			return this.#interpolate(ruleMessage, data);
		}

		return this.#interpolate(rawMessage, data);
	}

	toJSON(): { messages: ValidationMessages; fields: ValidationFields } {
		return { messages: this.#messages, fields: this.#fields };
	}
}
