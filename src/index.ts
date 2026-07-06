/**
 * @module @c9up/rune
 * @description Rune — Validation engine for the Ream framework
 * @implements FR38, FR39, FR40, FR41, FR42
 */

export { RuneError, RuneValidationError } from "./errors.js";
export type { MessagesProviderContract } from "./MessagesProvider.js";
export { SimpleMessagesProvider } from "./MessagesProvider.js";
export type {
	CompiledRule,
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
	bindRosetta,
	createRule,
	rules,
	schema,
	setValidationTranslator,
} from "./Schema.js";
