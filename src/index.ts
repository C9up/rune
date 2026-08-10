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
	setDateTransform,
	setValidationTranslator,
} from "./Schema.js";

import type { MessagesProviderContract } from "./MessagesProvider.js";
import type { RuleChain } from "./Schema.js";
import {
	bindDatabase,
	bindRosetta,
	compile,
	create,
	createAsyncRule,
	createRule,
	getGlobalMessagesProvider,
	rules,
	schema,
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
	bindRosetta,
	setDateTransform,
	setValidationTranslator,
	/** One-shot validation, VineJS `vine.validate({ schema, data })`. */
	validate<T extends Record<string, RuleChain>>(options: {
		schema: T | RuleChain;
		data: unknown;
	}) {
		return create(options.schema as T).validate(options.data);
	},
	/** One-shot non-throwing validation, VineJS `vine.tryValidate`. */
	tryValidate<T extends Record<string, RuleChain>>(options: {
		schema: T | RuleChain;
		data: unknown;
	}) {
		return create(options.schema as T).tryValidate(options.data);
	},
	/**
	 * Type the `meta` passed to `validate(data, { meta })` (VineJS
	 * `withMetaData`). Purely a typing seam — rune carries meta on the call.
	 */
	withMetaData<M extends Record<string, unknown>>(): {
		create<T extends Record<string, RuleChain>>(
			fields: T,
		): ReturnType<typeof create<T>>;
		meta: M;
	} {
		return { create, meta: {} as M };
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
