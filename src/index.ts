/**
 * @module @c9up/rune
 * @description Rune — Validation engine for the Ream framework
 * @implements FR38, FR39, FR40, FR41, FR42
 */

export { RuneError } from "./errors.js";
export type {
	RuleChain,
	ValidationError,
	ValidationMessageParams,
	ValidationResult,
	ValidationSchema,
	ValidationTranslator,
} from "./Schema.js";
export {
	bindRosetta,
	rules,
	schema,
	setValidationTranslator,
} from "./Schema.js";
