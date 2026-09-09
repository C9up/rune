/**
 * @module @c9up/rune
 * @description Rune — Validation engine for the Ream framework
 * @implements FR38, FR39, FR40, FR41, FR42
 */

export type { DateFormat } from "./date.js";
/**
 * Namespace import, mirroring `import { errors } from 'the upstream package'` — Adonis
 * code catches on `errors.E_VALIDATION_ERROR`, so the namespace has to exist at
 * the root and not only on the subpath.
 */
export * as errors from "./errors.js";
export { RuneError, RuneValidationError } from "./errors.js";
export type {
	AlphaOptions,
	EmailOptions,
	NormalizeEmailOptions,
	NormalizeUrlOptions,
	UrlOptions,
} from "./formats.js";
export type {
	MessageFieldContext,
	MessagesProviderContract,
} from "./MessagesProvider.js";
export { SimpleMessagesProvider } from "./MessagesProvider.js";
export {
	assertNativeAvailable,
	isNativeAvailable,
	RuneNativeRequiredError,
} from "./native.js";
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
	RecordKeysCallback,
	RuleChain,
	RuleValidator,
	UnionNoMatchCallback,
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
	setGlobalErrorReporter,
	setValidationTranslator,
} from "./Schema.js";

import * as runeHelpers from "./helpers.js";
import type { MessagesProviderContract } from "./MessagesProvider.js";
import type { RuleChain, ValidateOptions } from "./Schema.js";
import {
	bindDatabase,
	bindHostResolver,
	bindRosetta,
	compile,
	create,
	createAsyncRule,
	createRule,
	getConvertEmptyStringsToNull,
	getGlobalErrorReporter,
	getGlobalMessagesProvider,
	group,
	groupElse,
	groupIf,
	rules,
	schema,
	setConvertEmptyStringsToNull,
	setDateTransform,
	setGlobalErrorReporter,
	setGlobalMessagesProvider,
	setValidationTranslator,
} from "./Schema.js";

/**
 * A validator whose entry points REQUIRE `{ meta }`.
 *
 * upstream refuses `validate(data)` once `withMetaData<T>()` declared metadata as
 * required; keeping `meta` optional meant the guard existed at runtime but the
 * compiler still waved the missing-metadata call through.
 */
type WithRequiredMeta<V, M> = {
	[K in keyof V]: V[K] extends (data: infer D, options?: infer O) => infer R
		? (data: D, options: Omit<O & object, "meta"> & { meta: M }) => R
		: V[K];
};

/**
 * Default export: one object carrying the whole surface, imported as
 * `import rune from "@c9up/rune"`.
 *
 * The name is the deviation and the only one:
 * the type factories (`rune.string()`, `rune.date()`, …) and the validator
 * factories (`rune.create`, `rune.compile`) sit on one object exactly like
 * upstream, so an Adonis validator transcribes line for line.
 */
const rune = {
	...rules,
	schema,
	create,
	compile,
	createRule,
	createAsyncRule,
	// `group` carries its branch factories, mirroring `group.if/else`.
	group: Object.assign(group, {
		if: groupIf,
		else: groupElse,
		otherwise: groupElse,
	}),
	bindDatabase,
	bindHostResolver,
	bindRosetta,
	setDateTransform,
	setValidationTranslator,
	/**
	 * Convert `""` to `null` before validating (upstream
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
	/**
	 * Predicate helpers upstream exposes as `helpers`, for writing custom
	 * rules without reimplementing the same checks. The implementations, and the
	 * three deviations rune keeps, live in `./helpers.js`.
	 */
	helpers: {
		...runeHelpers,
		/** Make every property of a shape optional (upstream `helpers.optional`). */
		optional: (props: Record<string, RuleChain>): Record<string, RuleChain> =>
			Object.fromEntries(
				Object.entries(props).map(([key, chain]) => [
					key,
					chain.clone().optional(),
				]),
			),
	},
	/** One-shot validation, upstream `validate({ schema, data })`. */
	validate<T extends Record<string, RuleChain>>(
		options: { schema: T | RuleChain; data: unknown } & ValidateOptions,
	) {
		// Spread the whole ValidateOptions rather than re-listing its keys: the
		// hand-listed version silently dropped `errorReporter` when it was added.
		const { schema: fields, data, ...validateOptions } = options;
		return create(fields as T).validate(data, validateOptions);
	},
	/** One-shot non-throwing validation, upstream `tryValidate`. */
	tryValidate<T extends Record<string, RuleChain>>(
		options: { schema: T | RuleChain; data: unknown } & ValidateOptions,
	) {
		// Spread the whole ValidateOptions rather than re-listing its keys: the
		// hand-listed version silently dropped `errorReporter` when it was added.
		const { schema: fields, data, ...validateOptions } = options;
		return create(fields as T).tryValidate(data, validateOptions);
	},
	/**
	 * Type the `meta` passed to `validate(data, { meta })` (upstream
	 * `withMetaData`). Purely a typing seam — rune carries meta on the call.
	 */
	withMetaData<M extends Record<string, unknown>>(
		validateMeta?: (meta: M) => void,
	): {
		create<T extends Record<string, RuleChain>>(
			fields: T,
		): WithRequiredMeta<ReturnType<typeof create<T>>, M>;
		compile<T extends Record<string, RuleChain>>(
			fields: T,
		): WithRequiredMeta<ReturnType<typeof create<T>>, M>;
	} {
		function build<T extends Record<string, RuleChain>>(fields: T) {
			const validator = create(fields);
			if (!validateMeta) {
				return validator as WithRequiredMeta<ReturnType<typeof create<T>>, M>;
			}
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
			// Copy DESCRIPTORS, not values: `errorReporter` and
			// `messagesProvider` are accessor pairs, and a spread would
			// flatten them into dead plain properties — assigning to the copy
			// would then silently do nothing.
			const wrapped: typeof validator = Object.create(
				Object.getPrototypeOf(validator),
				Object.getOwnPropertyDescriptors(validator),
			);
			Object.assign(wrapped, {
				validate: guard(validator.validate),
				validateResult: guard(validator.validateResult),
				validateResultAsync: guard(validator.validateResultAsync),
				validateOrThrow: guard(validator.validateOrThrow),
				validateOrThrowAsync: guard(validator.validateOrThrowAsync),
				tryValidate: guard(validator.tryValidate),
				tryValidateSync: guard(validator.tryValidateSync),
			});
			return wrapped as WithRequiredMeta<ReturnType<typeof create<T>>, M>;
		}
		// upstream exposes BOTH spellings behind withMetaData; `compile` is the
		// one its own documentation uses, and it was missing here.
		return { create: build, compile: build };
	},
	/** Process-wide error reporter (upstream `errorReporter`). */
	set errorReporter(reporter: Parameters<typeof setGlobalErrorReporter>[0],) {
		setGlobalErrorReporter(reporter);
	},
	get errorReporter(): ReturnType<typeof getGlobalErrorReporter> {
		return getGlobalErrorReporter();
	},
	/** Bind the global messages provider (upstream `messagesProvider`). */
	set messagesProvider(provider: MessagesProviderContract | null) {
		setGlobalMessagesProvider(provider);
	},
	get messagesProvider(): MessagesProviderContract | null {
		return getGlobalMessagesProvider();
	},
};

export default rune;
