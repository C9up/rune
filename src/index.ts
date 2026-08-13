/**
 * @module @c9up/rune
 * @description Rune — Validation engine for the Ream framework
 * @implements FR38, FR39, FR40, FR41, FR42
 */

export type { DateFormat } from "./date.js";
/**
 * Namespace import, mirroring `import { errors } from '@vinejs/vine'` — Adonis
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
	setGlobalErrorReporter,
	setValidationTranslator,
} from "./Schema.js";

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
 * VineJS refuses `validate(data)` once `withMetaData<T>()` declared metadata as
 * required; keeping `meta` optional meant the guard existed at runtime but the
 * compiler still waved the missing-metadata call through.
 */
type WithRequiredMeta<V, M> = {
	[K in keyof V]: V[K] extends (data: infer D, options?: infer O) => infer R
		? (data: D, options: Omit<O & object, "meta"> & { meta: M }) => R
		: V[K];
};

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
	// `group` carries its branch factories, mirroring `vine.group.if/else`.
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
	/**
	 * Predicate helpers VineJS exposes as `vine.helpers`, for writing custom
	 * rules without reimplementing the same three checks each time.
	 */
	helpers: {
		/** `true` for `true`, `1`, `"1"`, `"true"`, `"on"`, `"yes"`. */
		isTrue: (value: unknown): boolean =>
			value === true ||
			value === 1 ||
			(typeof value === "string" &&
				["1", "true", "on", "yes"].includes(value.toLowerCase())),
		/** `true` for `false`, `0`, `"0"`, `"false"`, `"off"`, `"no"`. */
		isFalse: (value: unknown): boolean =>
			value === false ||
			value === 0 ||
			(typeof value === "string" &&
				["0", "false", "off", "no"].includes(value.toLowerCase())),
		/** Neither `undefined` nor `null` (an empty string IS defined). */
		exists: (value: unknown): boolean => value !== undefined && value !== null,
		/** `undefined` or `null`. */
		isMissing: (value: unknown): boolean =>
			value === undefined || value === null,
		/** A plain object, not an array and not `null`. */
		isObject: (value: unknown): value is Record<string, unknown> =>
			typeof value === "object" && value !== null && !Array.isArray(value),
		/** An array. */
		isArray: Array.isArray,
		/** Every listed key is present on the object (VineJS `helpers.hasKeys`). */
		hasKeys: (value: unknown, keys: readonly string[]): boolean =>
			typeof value === "object" &&
			value !== null &&
			keys.every((key) => key in value),
		/**
		 * No duplicate in the data set, optionally compared on one or more fields
		 * (VineJS `helpers.isDistinct`). `null` / `undefined` items are ignored,
		 * and items missing a compared key are SKIPPED, so two absent values are
		 * not a duplicate of each other.
		 */
		isDistinct: (
			dataSet: readonly unknown[],
			fields?: string | string[],
		): boolean => {
			const list = fields === undefined ? null : [fields].flat();
			const keys: string[] = [];
			for (const item of dataSet) {
				if (item === null || item === undefined) continue;
				if (list === null) {
					keys.push(JSON.stringify(item));
					continue;
				}
				if (typeof item !== "object" || item === null) continue;
				const record: Record<string, unknown> = { ...item };
				if (list.some((k) => record[k] === undefined || record[k] === null)) {
					continue;
				}
				keys.push(JSON.stringify(list.map((k) => record[k])));
			}
			return new Set(keys).size === keys.length;
		},
		/** Read a dotted path off the validated data (VineJS `helpers.getNestedValue`). */
		getNestedValue: (
			key: string,
			field: { data: Record<string, unknown> },
		): unknown => {
			let cursor: unknown = field.data;
			for (const segment of key.split(".")) {
				if (typeof cursor !== "object" || cursor === null) return undefined;
				cursor = (cursor as Record<string, unknown>)[segment];
			}
			return cursor;
		},
		/** Make every property of a shape optional (VineJS `helpers.optional`). */
		optional: (props: Record<string, RuleChain>): Record<string, RuleChain> =>
			Object.fromEntries(
				Object.entries(props).map(([key, chain]) => [
					key,
					chain.clone().optional(),
				]),
			),
	},
	/** One-shot validation, VineJS `vine.validate({ schema, data })`. */
	validate<T extends Record<string, RuleChain>>(
		options: { schema: T | RuleChain; data: unknown } & ValidateOptions,
	) {
		// Spread the whole ValidateOptions rather than re-listing its keys: the
		// hand-listed version silently dropped `errorReporter` when it was added.
		const { schema: fields, data, ...validateOptions } = options;
		return create(fields as T).validate(data, validateOptions);
	},
	/** One-shot non-throwing validation, VineJS `vine.tryValidate`. */
	tryValidate<T extends Record<string, RuleChain>>(
		options: { schema: T | RuleChain; data: unknown } & ValidateOptions,
	) {
		// Spread the whole ValidateOptions rather than re-listing its keys: the
		// hand-listed version silently dropped `errorReporter` when it was added.
		const { schema: fields, data, ...validateOptions } = options;
		return create(fields as T).tryValidate(data, validateOptions);
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
		): WithRequiredMeta<ReturnType<typeof create<T>>, M>;
	} {
		return {
			create<T extends Record<string, RuleChain>>(fields: T) {
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
				return {
					...validator,
					validate: guard(validator.validate),
					validateResult: guard(validator.validateResult),
					validateResultAsync: guard(validator.validateResultAsync),
					validateOrThrow: guard(validator.validateOrThrow),
					validateOrThrowAsync: guard(validator.validateOrThrowAsync),
					tryValidate: guard(validator.tryValidate),
					tryValidateSync: guard(validator.tryValidateSync),
				} as WithRequiredMeta<ReturnType<typeof create<T>>, M>;
			},
		};
	},
	/** Process-wide error reporter (VineJS `vine.errorReporter`). */
	set errorReporter(reporter: Parameters<typeof setGlobalErrorReporter>[0],) {
		setGlobalErrorReporter(reporter);
	},
	get errorReporter(): ReturnType<typeof getGlobalErrorReporter> {
		return getGlobalErrorReporter();
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
