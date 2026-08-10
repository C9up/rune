/**
 * @module @c9up/rune
 * @description Rune — Validation engine for the Ream framework
 * @implements FR38, FR39, FR40, FR41, FR42
 */

export type { DateFormat } from "./date.js";
export { RuneError, RuneValidationError } from "./errors.js";
export type {
	NormalizeEmailOptions,
	NormalizeUrlOptions,
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

import {
	bindDatabase,
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
};

export default rune;
