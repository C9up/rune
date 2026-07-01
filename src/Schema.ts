/**
 * Rune Validation Schema — fluent validation rules.
 *
 * @implements FR38, FR39, FR40, FR41
 */

import { RuneError } from "./errors.js";
import {
	isNativeAvailable,
	validateNative,
	warnNativeUnavailableOnce,
} from "./native.js";

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
 * Field context handed to `.use()` rules — mirrors VineJS's field context. It
 * exposes the value plus the surrounding data so a rule can validate across
 * fields (e.g. `password === passwordConfirmation`), and a `report()` sink to
 * raise errors (VineJS reports instead of returning a boolean).
 */
export interface FieldContext {
	/** The current field value (post-transform). */
	value: unknown;
	/** The root object being validated. Shared across fields — do NOT mutate. */
	data: Record<string, unknown>;
	/** The immediate parent container of this field (object or array). */
	parent: Record<string, unknown> | unknown[];
	/** Dotted path to the field, e.g. `address.city` or `tags.0`. */
	field: string;
	/** Runtime metadata passed to `validate(data, { meta })`. */
	meta: Record<string, unknown>;
	/** `true` while no error has been reported for this field yet. */
	isValid: boolean;
	/** Report a validation failure for this field. */
	report(message: string, rule: string): void;
}

/**
 * A `.use()` rule validator — VineJS shape `(value, options, field)`. Report
 * failures via `field.report(...)`; the return value is ignored.
 */
export type RuleValidator<Options = undefined> = (
	value: unknown,
	options: Options,
	field: FieldContext,
) => void;

/** A compiled `.use()` rule produced by {@link createRule}. */
export interface CompiledRule {
	readonly __rune: "rule";
	run(value: unknown, field: FieldContext): void;
}

/**
 * Turn a validator function into a reusable `.use()` rule — VineJS's
 * `createRule`. Returns a factory: call it with the rule's options to get a
 * `CompiledRule`, then attach it with `chain.use(rule(options))`.
 *
 *     const sameAs = createRule<string>((value, other, field) => {
 *       if (value !== field.data[other]) {
 *         field.report(`Must match ${other}`, 'sameAs')
 *       }
 *     })
 *     schema({
 *       password: rules.string().min(8),
 *       passwordConfirmation: rules.string().use(sameAs('password')),
 *     })
 */
export function createRule(
	validator: RuleValidator<undefined>,
): () => CompiledRule;
export function createRule<Options>(
	validator: RuleValidator<Options>,
): (options: Options) => CompiledRule;
export function createRule<Options>(
	validator: RuleValidator<Options>,
): (options: Options) => CompiledRule {
	return (options: Options): CompiledRule => ({
		__rune: "rule",
		run(value: unknown, field: FieldContext): void {
			validator(value, options, field);
		},
	});
}

/**
 * Validation result — discriminated union that narrows `data` to the schema's
 * `T` when `valid` is `true`, removing the need for callers to cast or guard
 * `data` separately.
 */
export type ValidationResult<T = Record<string, unknown>> =
	| { valid: true; errors: ValidationError[]; data: T }
	| { valid: false; errors: ValidationError[]; data?: undefined };

/** Options for {@link ValidationSchema.validate}. */
export interface ValidateOptions {
	/** Runtime metadata exposed to `.use()` rules via `field.meta` (VineJS parity). */
	meta?: Record<string, unknown>;
}

export interface ValidationSchema<T = Record<string, unknown>> {
	fields: Record<string, RuleChain>;
	validate(data: unknown, options?: ValidateOptions): ValidationResult<T>;
}

/** Context threaded through validation so field rules can reach root/parent/meta. */
interface RunContext {
	data: Record<string, unknown>;
	parent: Record<string, unknown> | unknown[];
	meta: Record<string, unknown>;
}

/** Default context for internal callers that don't supply one (no root available). */
const EMPTY_RUN_CONTEXT: RunContext = { data: {}, parent: {}, meta: {} };

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
		if (chain.useRules.length > 0) return true; // .use() rule — TS-only (Rust can't run JS)
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
		validate(data: unknown, options?: ValidateOptions): ValidationResult<T> {
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

			if (!hasCustomRules && !validationTranslator) {
				if (isNativeAvailable()) {
					return validateWithRust<T>(fields, data);
				}
				// This schema would have used the native engine, but it isn't
				// loaded — surface the platform-dependent TS fallback once instead
				// of diverging silently. (Schemas with custom rules / a translator
				// always run on TS by design and don't warn.)
				warnNativeUnavailableOnce();
			}

			const errors: ValidationError[] = [];
			const validated: Record<string, unknown> = {};
			// Root context: `data` is the root, `parent` of a top-level field is the
			// root too; nested/array recursion narrows `parent` as it descends.
			const rootCtx: RunContext = {
				data,
				parent: data,
				meta: options?.meta ?? {},
			};

			for (const [field, chain] of Object.entries(fields)) {
				const value = data[field];
				const result = chain._validateWithTransform(field, value, rootCtx);
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
	#useRules: CompiledRule[] = [];

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
	/** Public read access to `.use()` rules (used to keep such schemas off the native path). */
	get useRules(): readonly CompiledRule[] {
		return this.#useRules;
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
			// Mirror the Rust engine's regex exactly (crates/rune-engine/src/engine.rs)
			// so the SAME schema validates identically whether or not the native
			// binary loaded: no whitespace anywhere (the old TS rule rejected only
			// \r\n, silently accepting interior spaces), a single @, dotted domain.
			validate: (v) =>
				typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
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

	/**
	 * Attach a `.use()` rule (from {@link createRule}). Unlike `custom`, the rule
	 * receives a {@link FieldContext} with the root `data` and `parent`, so it can
	 * validate across fields. Runs after this field's type/value rules.
	 */
	use(rule: CompiledRule): this {
		if (rule?.__rune !== "rule" || typeof rule.run !== "function") {
			throw new RuneError(
				"INVALID_RULE",
				"use() expects a compiled rule — call the factory first",
				{ hint: "use(myRule()) or use(myRule(options)), not use(myRule)" },
			);
		}
		this.#useRules.push(rule);
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
		ctx: RunContext = EMPTY_RUN_CONTEXT,
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

		// 3. Vine-style .use() rules — run with a FieldContext exposing the root
		//    `data` and `parent`, so a rule can validate across fields.
		if (this.#useRules.length > 0) {
			this.#runUseRules(field, transformed, ctx, errors);
		}

		// 4. Nested object validation (only if type check passed — not arrays)
		if (this.#nestedSchema && isPlainObject(transformed)) {
			const obj: Record<string, unknown> = { ...transformed };
			transformed = obj;
			for (const [nestedField, chain] of Object.entries(this.#nestedSchema)) {
				const nestedResult = chain._validateWithTransform(
					`${field}.${nestedField}`,
					obj[nestedField],
					{ data: ctx.data, parent: obj, meta: ctx.meta },
				);
				errors.push(...nestedResult.errors);
				if (nestedResult.transformed !== undefined) {
					obj[nestedField] = nestedResult.transformed;
				}
			}
		}

		// 5. Array item validation
		if (this.#arrayItemChain && Array.isArray(transformed)) {
			const arr: unknown[] = [...transformed];
			transformed = arr;
			for (let i = 0; i < arr.length; i++) {
				const itemResult = this.#arrayItemChain._validateWithTransform(
					`${field}.${i}`,
					arr[i],
					{ data: ctx.data, parent: arr, meta: ctx.meta },
				);
				errors.push(...itemResult.errors);
				if (itemResult.transformed !== undefined) {
					arr[i] = itemResult.transformed;
				}
			}
		}

		return { errors, transformed };
	}

	/** Run `.use()` rules on the transformed value with a fresh FieldContext. */
	#runUseRules(
		field: string,
		transformed: unknown,
		ctx: RunContext,
		errors: ValidationError[],
	): void {
		const fieldCtx: FieldContext = {
			value: transformed,
			data: ctx.data,
			parent: ctx.parent,
			field,
			meta: ctx.meta,
			isValid: errors.length === 0,
			report(message: string, rule: string): void {
				errors.push({ field, rule, message });
			},
		};
		for (const rule of this.#useRules) {
			// Refresh isValid so a rule can early-return once the field has failed.
			fieldCtx.isValid = errors.length === 0;
			rule.run(transformed, fieldCtx);
		}
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
			// Serialize THIS rule's own param. Previously a find-first lookup by
			// rule name returned the first matching rule's param, so min(3).min(5)
			// sent both Rust entries as min=3, dropping the 5 bound (audit 2026-06-13).
			params:
				r.name === "min"
					? { min: r.param }
					: r.name === "max"
						? { max: r.param }
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
