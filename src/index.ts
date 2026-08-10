/**
 * @module @c9up/rune
 * @description Rune — Validation engine for the Ream framework
 * @implements FR38, FR39, FR40, FR41, FR42
 */

export type { DateFormat } from "./date.js";
export { RuneError, RuneValidationError } from "./errors.js";
export type {
	AlphaOptions,
	NormalizeEmailOptions,
	NormalizeUrlOptions,
	UrlOptions,
} from "./formats.js";
export type { MessagesProviderContract } from "./MessagesProvider.js";
export { SimpleMessagesProvider } from "./MessagesProvider.js";
export type {
	AsyncCompiledRule,
	AsyncRuleValidator,
	CompiledRule,
	CreateRuleOptions,
	DatabaseLookup,
	DatabaseResolver,
	DatabaseRuleOptions,
	FieldContext,
	Infer,
	RuleChain,
	RuleValidator,
	ValidateOptions,
	ValidationError,
	ValidationMessageParams,
	ValidationResult,
	ValidationSchema,
	ValidationTranslator,
} from "./Schema.js";
export {
	bindDatabase,
	bindHostResolver,
	bindRosetta,
	compile,
	create,
	createAsyncRule,
	createRule,
	rules,
	schema,
	setConvertEmptyStringsToNull,
	setDateTransform,
	setValidationTranslator,
} from "./Schema.js";

import type { MessagesProviderContract } from "./MessagesProvider.js";
import type { RuleChain } from "./Schema.js";
import {
	bindDatabase,
	bindHostResolver,
	bindRosetta,
	compile,
	create,
	createAsyncRule,
	createRule,
	getConvertEmptyStringsToNull,
	getGlobalMessagesProvider,
	rules,
	schema,
	setConvertEmptyStringsToNull,
	setDateTransform,
	setGlobalMessagesProvider,
	setValidationTranslator,
} from "./Schema.js";

/**
 * Default export, mirroring `import vine from '@vinejs/vine'`.
 *
 * Named `rune`, not `vine` — the deviation is the package name, nothing else:
 * the type factories (`rune.string()`, `rune.date()`, …) and the validator
 * factories (`rune.create`, `rune.compile`) sit on one object exactly like
 * VineJS, so an Adonis validator transcribes line for line.
 */
const rune = {
	...rules,
	schema,
	create,
	compile,
	createRule,
	createAsyncRule,
	bindDatabase,
	bindHostResolver,
	bindRosetta,
	setDateTransform,
	setValidationTranslator,
	/**
	 * Convert `""` to `null` before validating (VineJS
	 * `convertEmptyStringsToNull`). An HTML form posts empty inputs as `""`, and
	 * an optional field should read that as "absent", not as a present empty
	 * string that fails `minLength`.
	 */
	set convertEmptyStringsToNull(enabled: boolean) {
		setConvertEmptyStringsToNull(enabled);
	},
	get convertEmptyStringsToNull(): boolean {
		return getConvertEmptyStringsToNull();
	},
	/** One-shot validation, VineJS `vine.validate({ schema, data })`. */
	validate<T extends Record<string, RuleChain>>(options: {
		schema: T | RuleChain;
		data: unknown;
		meta?: Record<string, unknown>;
		messagesProvider?: MessagesProviderContract;
	}) {
		return create(options.schema as T).validate(options.data, {
			meta: options.meta,
			messagesProvider: options.messagesProvider,
		});
	},
	/** One-shot non-throwing validation, VineJS `vine.tryValidate`. */
	tryValidate<T extends Record<string, RuleChain>>(options: {
		schema: T | RuleChain;
		data: unknown;
		meta?: Record<string, unknown>;
		messagesProvider?: MessagesProviderContract;
	}) {
		return create(options.schema as T).tryValidate(options.data, {
			meta: options.meta,
			messagesProvider: options.messagesProvider,
		});
	},
	/**
	 * Type the `meta` passed to `validate(data, { meta })` (VineJS
	 * `withMetaData`). Purely a typing seam — rune carries meta on the call.
	 */
	withMetaData<M extends Record<string, unknown>>(
		validateMeta?: (meta: M) => void,
	): {
		create<T extends Record<string, RuleChain>>(
			fields: T,
		): ReturnType<typeof create<T>>;
	} {
		return {
			create<T extends Record<string, RuleChain>>(fields: T) {
				const validator = create(fields);
				if (!validateMeta) return validator;
				// The callback runs BEFORE the payload: meta that is wrong makes
				// every rule reading it meaningless, so failing early is the only
				// honest outcome.
				const guard = <A extends unknown[], R>(
					run: (...args: A) => R,
				): ((...args: A) => R) => {
					return (...args: A): R => {
						const options = args[1] as { meta?: M } | undefined;
						validateMeta((options?.meta ?? {}) as M);
						return run(...args);
					};
				};
				return {
					...validator,
					validate: guard(validator.validate),
					validateResult: guard(validator.validateResult),
					validateResultAsync: guard(validator.validateResultAsync),
					validateOrThrow: guard(validator.validateOrThrow),
					validateOrThrowAsync: guard(validator.validateOrThrowAsync),
					tryValidate: guard(validator.tryValidate),
					tryValidateSync: guard(validator.tryValidateSync),
				} as ReturnType<typeof create<T>>;
			},
		};
	},
	/** Bind the global messages provider (VineJS `vine.messagesProvider`). */
	set messagesProvider(provider: MessagesProviderContract | null) {
		setGlobalMessagesProvider(provider);
	},
	get messagesProvider(): MessagesProviderContract | null {
		return getGlobalMessagesProvider();
	},
};

export default rune;
