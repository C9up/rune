/**
 * Rune Validation Schema — fluent validation rules.
 *
 * @implements FR38, FR39, FR40, FR41
 */

import { RuneError } from "./errors.js";
import { isNativeAvailable, validateNative } from "./native.js";

export type ValidationMessageParams = Record<string, string | number | boolean>;
export type ValidationTranslator = (
	key: string,
	params?: ValidationMessageParams,
) => string | undefined;

export interface ValidationError {
	field: string;
	rule: string;
	message: string;
}

/**
 * Validation result — discriminated union that narrows `data` to the schema's
 * `T` when `valid` is `true`, removing the need for callers to cast or guard
 * `data` separately.
 */
export type ValidationResult<T = Record<string, unknown>> =
	| { valid: true; errors: ValidationError[]; data: T }
	| { valid: false; errors: ValidationError[]; data?: undefined };

export interface ValidationSchema<T = Record<string, unknown>> {
	fields: Record<string, RuleChain>;
	validate(data: unknown): ValidationResult<T>;
}

/** Type guard: narrows `unknown` to a plain object (non-null, non-array, typeof 'object'). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rules the Rust validation engine can handle natively. */
const STANDARD_RULES: ReadonlySet<string> = new Set([
	"string",
	"number",
	"boolean",
	"min",
	"max",
	"email",
	"positive",
]);

/** Default messages for standard rules — used to detect custom-message overrides. */
const STANDARD_MSGS: Readonly<Record<string, string>> = {
	string: "Must be a string",
	number: "Must be a number",
	boolean: "Must be a boolean",
	min: "Minimum",
	max: "Maximum",
	email: "Must be a valid email",
	positive: "Must be positive",
};

const TYPE_RULE_NAMES: ReadonlySet<string> = new Set([
	"string",
	"number",
	"boolean",
	"object",
	"array",
]);
let validationTranslator: ValidationTranslator | undefined;

function hasDefaultMessage(rule: RuleDef): boolean {
	if (rule.name === "min" || rule.name === "max") {
		if (typeof rule.param !== "number") return false;
		const expected = `${rule.name === "min" ? "Minimum" : "Maximum"} ${rule.param}`;
		return rule.message === expected;
	}

	const defaultMsg = STANDARD_MSGS[rule.name];
	return defaultMsg !== undefined && rule.message === defaultMsg;
}

function resolveValidationMessage(
	key: string,
	fallback: string,
	params?: ValidationMessageParams,
): string {
	const translated = validationTranslator?.(key, params);
	if (typeof translated === "string" && translated.length > 0) {
		return translated;
	}
	return fallback;
}

function resolveRuleMessage(field: string, rule: RuleDef): string {
	const fallback = rule.message;
	if (!STANDARD_RULES.has(rule.name)) {
		return fallback;
	}
	if (!hasDefaultMessage(rule)) {
		return fallback;
	}

	const params: ValidationMessageParams = { field };
	if (rule.name === "min" && typeof rule.param === "number") {
		params.min = rule.param;
	}
	if (rule.name === "max" && typeof rule.param === "number") {
		params.max = rule.param;
	}

	return resolveValidationMessage(`validation.${rule.name}`, fallback, params);
}

/** Compute once: does any field rule prevent dispatching to Rust? */
function detectHasCustomRules(fields: Record<string, RuleChain>): boolean {
	return Object.values(fields).some((chain) => {
		return chain.rules.some((r) => {
			if (!STANDARD_RULES.has(r.name)) return true; // custom rule
			if (!hasDefaultMessage(r)) return true; // custom message
			return false;
		});
	});
}

/**
 * Create a validation schema.
 *
 * Pass `T` explicitly when the caller wants `result.data` typed as a concrete
 * shape after `result.valid === true` narrows the union — runtime validation
 * is unchanged, the generic only types the success branch.
 *
 *     const RegisterValidator = schema<{ email: string; password: string }>({
 *       email: rules.string().email(),
 *       password: rules.string().min(8),
 *     });
 *
 * The default `Record<string, unknown>` matches the historical untyped surface
 * so existing call sites that read `result.data` field-by-field with their
 * own narrowing continue to compile.
 */
export function schema<T = Record<string, unknown>>(
	fields: Record<string, RuleChain>,
): ValidationSchema<T> {
	// Computed once at construction time, not per validate() call.
	const hasCustomRules = detectHasCustomRules(fields);

	return {
		fields,
		validate(data: unknown): ValidationResult<T> {
			if (!isPlainObject(data)) {
				return {
					valid: false,
					errors: [
						{
							field: "_root",
							rule: "type",
							message: "Input must be an object",
						},
					],
				};
			}

			if (isNativeAvailable() && !hasCustomRules && !validationTranslator) {
				return validateWithRust<T>(fields, data);
			}

			const errors: ValidationError[] = [];
			const validated: Record<string, unknown> = {};

			for (const [field, chain] of Object.entries(fields)) {
				const value = data[field];
				const result = chain._validateWithTransform(field, value);
				errors.push(...result.errors);
				if (result.errors.length === 0 && value !== undefined) {
					validated[field] = result.transformed;
				}
			}

			if (errors.length === 0) {
				return { valid: true, errors, data: validated as T };
			}
			return { valid: false, errors };
		},
	};
}

export function setValidationTranslator(
	translator?: ValidationTranslator,
): void {
	validationTranslator = translator;
}

export function bindRosetta(rosetta: {
	t(key: string, params?: ValidationMessageParams): string;
}): void {
	setValidationTranslator((key, params) => rosetta.t(key, params));
}

/** Rule definition stored on a chain. */
export interface RuleDef {
	name: string;
	param?: number;
	validate: (value: unknown) => boolean;
	message: string;
}

/** Rule chain — fluent validation builder. */
export class RuleChain {
	#rules: RuleDef[] = [];
	#isOptional = false;
	#transforms: Array<{ name: string; fn: (value: unknown) => unknown }> = [];
	#nestedSchema: Record<string, RuleChain> | null = null;
	#arrayItemChain: RuleChain | null = null;

	/** Public read access to rules (for OpenAPI generation, Rust bridge). */
	get rules(): readonly RuleDef[] {
		return this.#rules;
	}
	get isOptionalField(): boolean {
		return this.#isOptional;
	}
	get transforms(): ReadonlyArray<{
		name: string;
		fn: (value: unknown) => unknown;
	}> {
		return this.#transforms;
	}

	/** Mark field as optional. */
	optional(): this {
		this.#isOptional = true;
		return this;
	}

	/** Must be an object matching a nested schema. */
	object(shape: Record<string, RuleChain>): this {
		this.#rules.push({
			name: "object",
			validate: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
			message: "Must be an object",
		});
		this.#nestedSchema = shape;
		return this;
	}

	/** Must be an array. Items validated by the provided chain. */
	array(itemChain?: RuleChain): this {
		this.#rules.push({
			name: "array",
			validate: (v) => Array.isArray(v),
			message: "Must be an array",
		});
		this.#arrayItemChain = itemChain ?? null;
		return this;
	}

	/** Must be a string. */
	string(): this {
		this.#rules.push({
			name: "string",
			validate: (v) => typeof v === "string",
			message: "Must be a string",
		});
		return this;
	}

	/** Must be a number. */
	number(): this {
		this.#rules.push({
			name: "number",
			validate: (v) =>
				typeof v === "number" && !Number.isNaN(v) && Number.isFinite(v),
			message: "Must be a number",
		});
		return this;
	}

	/** Must be a boolean. */
	boolean(): this {
		this.#rules.push({
			name: "boolean",
			validate: (v) => typeof v === "boolean",
			message: "Must be a boolean",
		});
		return this;
	}

	/** Minimum length (string) or minimum value (number). */
	min(n: number): this {
		this.#rules.push({
			name: "min",
			param: n,
			validate: (v) =>
				typeof v === "string"
					? [...v].length >= n
					: typeof v === "number"
						? v >= n
						: false,
			message: `Minimum ${n}`,
		});
		return this;
	}

	/** Maximum length (string) or maximum value (number). */
	max(n: number): this {
		this.#rules.push({
			name: "max",
			param: n,
			validate: (v) =>
				typeof v === "string"
					? [...v].length <= n
					: typeof v === "number"
						? v <= n
						: false,
			message: `Maximum ${n}`,
		});
		return this;
	}

	/** Must be a valid email. */
	email(): this {
		this.#rules.push({
			name: "email",
			validate: (v) => {
				if (typeof v !== "string") return false;
				if (/[\r\n]/.test(v)) return false;
				const at = v.indexOf("@");
				if (at <= 0 || at !== v.lastIndexOf("@")) return false;
				const domain = v.slice(at + 1);
				const dot = domain.lastIndexOf(".");
				return dot > 0 && dot < domain.length - 1;
			},
			message: "Must be a valid email",
		});
		return this;
	}

	/** Must be positive (> 0) and finite. */
	positive(): this {
		this.#rules.push({
			name: "positive",
			validate: (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
			message: "Must be positive",
		});
		return this;
	}

	/** Trim whitespace (transform). */
	trim(): this {
		this.#transforms.push({
			name: "trim",
			fn: (v) => (typeof v === "string" ? v.trim() : v),
		});
		return this;
	}

	/** Custom validation rule. */
	custom(
		name: string,
		validate: (value: unknown) => boolean,
		message?: string,
	): this {
		this.#rules.push({
			name,
			validate,
			message: message ?? `Failed custom rule: ${name}`,
		});
		return this;
	}

	/** Set custom error message for the last rule. */
	message(msg: string): this {
		if (this.#rules.length === 0) {
			throw new RuneError("NO_RULE", "message() must be called after a rule");
		}
		this.#rules[this.#rules.length - 1].message = msg;
		return this;
	}

	/** Internal: validate a field value and return errors + transformed value. */
	_validateWithTransform(
		field: string,
		value: unknown,
	): { errors: ValidationError[]; transformed: unknown } {
		if (value === undefined || value === null) {
			if (this.#isOptional) return { errors: [], transformed: value };
			return { errors: [this.#requiredError(field)], transformed: value };
		}

		// 1. Type rules first on the raw value — bail on type mismatch.
		const typeError = this.#runTypeRules(field, value);
		if (typeError) return { errors: [typeError], transformed: value };

		// 2. Apply transforms (trim, etc.), then run value rules on the result.
		let transformed = this.#applyTransformsTo(value);
		const errors = this.#runValueRules(field, transformed);

		// 4. Nested object validation (only if type check passed — not arrays)
		if (
			this.#nestedSchema &&
			typeof transformed === "object" &&
			transformed !== null &&
			!Array.isArray(transformed)
		) {
			transformed = { ...(transformed as Record<string, unknown>) };
			for (const [nestedField, chain] of Object.entries(this.#nestedSchema)) {
				const nestedValue = (transformed as Record<string, unknown>)[
					nestedField
				];
				const nestedResult = chain._validateWithTransform(
					`${field}.${nestedField}`,
					nestedValue,
				);
				errors.push(...nestedResult.errors);
				if (nestedResult.transformed !== undefined) {
					(transformed as Record<string, unknown>)[nestedField] =
						nestedResult.transformed;
				}
			}
		}

		// 5. Array item validation
		if (this.#arrayItemChain && Array.isArray(transformed)) {
			transformed = [...transformed];
			for (let i = 0; i < (transformed as unknown[]).length; i++) {
				const itemResult = this.#arrayItemChain._validateWithTransform(
					`${field}.${i}`,
					(transformed as unknown[])[i],
				);
				errors.push(...itemResult.errors);
				if (itemResult.transformed !== undefined) {
					(transformed as unknown[])[i] = itemResult.transformed;
				}
			}
		}

		return { errors, transformed };
	}

	#requiredError(field: string): ValidationError {
		return {
			field,
			rule: "required",
			message: resolveValidationMessage(
				"validation.required",
				`${field} is required`,
				{ field },
			),
		};
	}

	/** Run the type rules (string/number/…) on the raw value; first failure bails. */
	#runTypeRules(field: string, value: unknown): ValidationError | null {
		for (const rule of this.#rules) {
			if (TYPE_RULE_NAMES.has(rule.name) && !rule.validate(value)) {
				return {
					field,
					rule: rule.name,
					message: resolveRuleMessage(field, rule),
				};
			}
		}
		return null;
	}

	/** Run the non-type rules (min/max/email/…) on the transformed value. */
	#runValueRules(field: string, transformed: unknown): ValidationError[] {
		const errors: ValidationError[] = [];
		for (const rule of this.#rules) {
			if (!TYPE_RULE_NAMES.has(rule.name) && !rule.validate(transformed)) {
				errors.push({
					field,
					rule: rule.name,
					message: resolveRuleMessage(field, rule),
				});
			}
		}
		return errors;
	}

	/** Internal: validate a field value against all rules. */
	_validate(field: string, value: unknown): ValidationError[] {
		return this._validateWithTransform(field, value).errors;
	}

	/** Internal: apply transforms. */
	_transform(value: unknown): unknown {
		return this.#applyTransformsTo(value);
	}

	#applyTransformsTo(value: unknown): unknown {
		let result = value;
		for (const transform of this.#transforms) {
			result = transform.fn(result);
		}
		return result;
	}
}

/** Entry point for building rules. */
export const rules = {
	string: () => new RuleChain().string(),
	number: () => new RuleChain().number(),
	boolean: () => new RuleChain().boolean(),
	any: () => new RuleChain(),
};

/** Serialize schema + data and validate via Rust NAPI. */
function validateWithRust<T>(
	fields: Record<string, RuleChain>,
	data: Record<string, unknown>,
): ValidationResult<T> {
	const schemaDesc: Record<
		string,
		{
			rules: Array<{ name: string; params: unknown }>;
			optional: boolean;
			transforms: string[];
		}
	> = {};

	for (const [field, chain] of Object.entries(fields)) {
		const rules = chain.rules.map((r) => ({
			name: r.name,
			params:
				r.name === "min"
					? { min: extractParam(chain, "min") }
					: r.name === "max"
						? { max: extractParam(chain, "max") }
						: null,
		}));
		schemaDesc[field] = {
			rules,
			optional: chain.isOptionalField,
			transforms: chain.transforms.map((t) => t.name),
		};
	}

	const request = JSON.stringify({ schema: schemaDesc, data });
	const native = validateNative(request);
	if (native.valid && native.data !== undefined) {
		return { valid: true, errors: native.errors, data: native.data as T };
	}
	return { valid: false, errors: native.errors };
}

function extractParam(chain: RuleChain, ruleName: string): number | undefined {
	const rule = chain.rules.find((r) => r.name === ruleName);
	if (!rule) return undefined;
	// Use stored param directly (no longer parsed from message text)
	return rule.param;
}
