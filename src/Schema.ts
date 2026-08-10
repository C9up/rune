/**
 * Rune Validation Schema — fluent validation rules.
 *
 * @implements FR38, FR39, FR40, FR41
 */

import {
	type DateFormat,
	parseDateValue,
	resolveOperand,
	startOfDay,
} from "./date.js";
import type { RuneErrorNode } from "./errors.js";
import { RuneError, RuneValidationError } from "./errors.js";
import {
	escapeHtml,
	isAscii,
	isCoordinates,
	isCreditCard,
	isHexCode,
	isIban,
	isIpAddress,
	isJwt,
	isMobile,
	isPassport,
	isPostalCode,
	isUlid,
	type NormalizeEmailOptions,
	type NormalizeUrlOptions,
	normalizeEmail,
	normalizeUrl,
	SUPPORTED_PASSPORTS,
	SUPPORTED_POSTAL_CODES,
	toCamelCase,
} from "./formats.js";
import type { MessagesProviderContract } from "./MessagesProvider.js";
import { toWildcardPath } from "./MessagesProvider.js";
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
	/** Array index when the field is an array item (VineJS parity). */
	index?: number;
	/** Rule metadata carried for reporters/i18n (e.g. `{ min: 3 }`). */
	meta?: Record<string, unknown>;
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
	/** Last path segment — `city` for `address.city` (VineJS `name`). */
	name: string;
	/** Dotted path with numeric segments replaced by `*` (`tags.*.name`). */
	wildCardPath: string;
	/** `true` when this value sits inside an array. */
	isArrayMember: boolean;
	/** `true` when the value is neither `undefined` nor `null`. */
	isDefined: boolean;
	/** `true` when the value passed its type rule. */
	isValidDataType: boolean;
	/** The full dotted path — same value as {@link field}, VineJS spelling. */
	getFieldPath(): string;
	/** Replace the value under validation (VineJS `mutate`). */
	mutate(newValue: unknown): void;
	/**
	 * Report a validation failure. `field` and `args` are optional (VineJS
	 * passes four arguments); omitting them reports against this field with no
	 * interpolation data.
	 */
	report(
		message: string,
		rule: string,
		field?: string,
		args?: Record<string, unknown>,
	): void;
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
	/** Run even on `undefined`/`null` (VineJS implicit rules). */
	readonly implicit?: boolean;
	readonly name?: string;
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
/**
 * Options accepted by {@link createRule} / {@link createAsyncRule} — VineJS
 * `vine.createRule(fn, { implicit, isAsync })`.
 */
export interface CreateRuleOptions {
	/**
	 * Run the rule even when the value is `undefined` or `null`. Non-implicit
	 * rules are skipped on an absent value, which is why a `required`-style
	 * custom rule could not be written before.
	 */
	implicit?: boolean;
	/** Rule name reported in errors when the validator does not pass one. */
	name?: string;
}

export function createRule(
	validator: RuleValidator<undefined>,
	options?: CreateRuleOptions,
): () => CompiledRule;
export function createRule<Options>(
	validator: RuleValidator<Options>,
	options?: CreateRuleOptions,
): (options: Options) => CompiledRule;
export function createRule<Options>(
	validator: RuleValidator<Options>,
	ruleOptions?: CreateRuleOptions,
): (options: Options) => CompiledRule {
	return (options: Options): CompiledRule => ({
		__rune: "rule",
		implicit: ruleOptions?.implicit ?? false,
		name: ruleOptions?.name,
		run(value: unknown, field: FieldContext): void {
			validator(value, options, field);
		},
	});
}

/**
 * An async `.useAsync()` rule validator — same shape as {@link RuleValidator}
 * but may return a Promise. Runs only under {@link ValidationSchema.validateAsync}.
 */
export type AsyncRuleValidator<Options = undefined> = (
	value: unknown,
	options: Options,
	field: FieldContext,
) => void | Promise<void>;

/** A compiled async rule produced by {@link createAsyncRule}. */
export interface AsyncCompiledRule {
	readonly __rune: "asyncRule";
	/** Run even on `undefined`/`null` (VineJS implicit rules). */
	readonly implicit?: boolean;
	readonly name?: string;
	run(value: unknown, field: FieldContext): Promise<void>;
}

/**
 * Async counterpart of {@link createRule} — for rules that must await (DB lookups
 * etc.). Attach with `chain.useAsync(rule(options))`; the schema must then be run
 * with `validateAsync`. This is how DB-backed `unique`/`exists` rules are built
 * (the validator does the query), keeping rune framework-agnostic.
 */
export function createAsyncRule(
	validator: AsyncRuleValidator<undefined>,
	options?: CreateRuleOptions,
): () => AsyncCompiledRule;
export function createAsyncRule<Options>(
	validator: AsyncRuleValidator<Options>,
	options?: CreateRuleOptions,
): (options: Options) => AsyncCompiledRule;
export function createAsyncRule<Options>(
	validator: AsyncRuleValidator<Options>,
	ruleOptions?: CreateRuleOptions,
): (options: Options) => AsyncCompiledRule {
	return (options: Options): AsyncCompiledRule => ({
		__rune: "asyncRule",
		implicit: ruleOptions?.implicit ?? false,
		name: ruleOptions?.name,
		async run(value: unknown, field: FieldContext): Promise<void> {
			await validator(value, options, field);
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
	/**
	 * VineJS-style messages provider. When supplied, default rule messages are
	 * resolved through it (custom `.message()` overrides still win, and the
	 * provider takes precedence over a globally bound translator).
	 */
	messagesProvider?: MessagesProviderContract;
}

export interface ValidationSchema<T = Record<string, unknown>> {
	fields: Record<string, RuleChain>;
	/** Result-based validation (superset) — never throws. */
	validate(data: unknown, options?: ValidateOptions): ValidationResult<T>;
	/**
	 * Throwing validation (VineJS/Adonis parity). Returns the validated data on
	 * success; throws {@link RuneValidationError} (`E_VALIDATION_ERROR`, HTTP 422)
	 * with a structured `.messages` array on failure.
	 */
	validateOrThrow(data: unknown, options?: ValidateOptions): T;
	/**
	 * Non-throwing validation returning `[error, null] | [null, data]`
	 * (VineJS `tryValidate`).
	 */
	tryValidate(
		data: unknown,
		options?: ValidateOptions,
	): [RuneValidationError, null] | [null, T];
	/** Async counterpart of {@link tryValidate}. */
	tryValidateAsync(
		data: unknown,
		options?: ValidateOptions,
	): Promise<[RuneValidationError, null] | [null, T]>;
	/**
	 * Async validation — runs the sync rules, then any `.useAsync()`/`unique`/
	 * `exists` rules (awaited). Required when the schema carries async rules; the
	 * sync {@link validate} throws for such a schema rather than silently skipping
	 * them.
	 */
	validateAsync(
		data: unknown,
		options?: ValidateOptions,
	): Promise<ValidationResult<T>>;
	/** Throwing async validation (see {@link validateAsync} + {@link validateOrThrow}). */
	validateOrThrowAsync(data: unknown, options?: ValidateOptions): Promise<T>;
}

/** Context threaded through validation so field rules can reach root/parent/meta. */
interface RunContext {
	data: Record<string, unknown>;
	parent: Record<string, unknown> | unknown[];
	meta: Record<string, unknown>;
	messagesProvider?: MessagesProviderContract;
}

/**
 * An async rule run deferred by the (synchronous) traversal and awaited by
 * `validateAsync`. Collected at EVERY depth — top-level fields, nested object
 * fields and array items alike.
 */
interface PendingAsync {
	chain: RuleChain;
	field: string;
	value: unknown;
	ctx: RunContext;
}

/**
 * Global output mapper for `rules.date()` — VineJS's `VineDate.transform` seam.
 *
 * rune has zero runtime dependencies, so a validated date is a plain `Date`. A
 * consumer that wants its own type (e.g. a `@c9up/chronos` `DateTime`, which is
 * what atlas hands back on read) binds it here once at boot, exactly like
 * `bindRosetta` does for translations. Applied AFTER the comparison rules, so
 * `after`/`before` always compare real `Date`s.
 */
let dateOutputTransform: ((value: Date) => unknown) | null = null;

/** Bind (or clear, with `null`) the global `rules.date()` output mapper. */
export function setDateTransform(fn: ((value: Date) => unknown) | null): void {
	dateOutputTransform = fn;
}

/**
 * A database lookup seam for the Lucid-style `unique` / `exists` rules.
 *
 * rune stays framework-agnostic, so it never imports a driver: the host binds
 * one resolver at boot (as `bindRosetta` does for translations) and the rules
 * then take Lucid's `{ table, column, where }` options instead of a hand-written
 * callback. The callback form is kept — it is what the resolver is built from.
 */
export interface DatabaseResolver {
	/** Resolve `true` when at least one row matches. */
	exists(query: DatabaseLookup): Promise<boolean>;
}

/** The lookup handed to a {@link DatabaseResolver} (Lucid `unique`/`exists`). */
export interface DatabaseLookup {
	table: string;
	column: string;
	value: unknown;
	/** Extra equality filters, e.g. `{ tenant_id: 3 }` (Lucid `where`). */
	where?: Record<string, unknown>;
	/** Rows to ignore, e.g. `{ id: 7 }` when updating (Lucid `whereNot`). */
	whereNot?: Record<string, unknown>;
}

let databaseResolver: DatabaseResolver | null = null;

/** Bind (or clear, with `null`) the resolver backing `unique()` / `exists()`. */
export function bindDatabase(resolver: DatabaseResolver | null): void {
	databaseResolver = resolver;
}

/** Options form of `unique()` / `exists()` — Lucid's shape. */
export interface DatabaseRuleOptions {
	table: string;
	column?: string;
	where?: Record<string, unknown>;
	whereNot?: Record<string, unknown>;
}

/**
 * Turn the options form of `unique`/`exists` into the callback the rule runs.
 * Fails loudly when no resolver is bound: a uniqueness check that cannot run
 * must never look like one that passed.
 */
function toDatabaseCheck(
	checkOrOptions:
		| ((value: unknown, field: FieldContext) => boolean | Promise<boolean>)
		| DatabaseRuleOptions,
	kind: "unique" | "exists",
): (value: unknown, field: FieldContext) => boolean | Promise<boolean> {
	if (typeof checkOrOptions === "function") return checkOrOptions;
	const options = checkOrOptions;
	return async (value, field) => {
		if (!databaseResolver) {
			throw new RuneError(
				"NO_DATABASE_RESOLVER",
				`rules.${kind}({ table }) needs a database resolver.`,
				{
					hint: "Call bindDatabase(resolver) once at boot, or pass a callback.",
				},
			);
		}
		const found = await databaseResolver.exists({
			table: options.table,
			column: options.column ?? field.name,
			value,
			where: options.where,
			whereNot: options.whereNot,
		});
		return kind === "unique" ? !found : found;
	};
}

/** The checkbox-style truthies VineJS `accepted` recognises. */
function isAcceptedValue(value: unknown): boolean {
	return (
		value === true ||
		value === 1 ||
		(typeof value === "string" &&
			["1", "on", "yes", "true"].includes(value.toLowerCase()))
	);
}

/** Default context for internal callers that don't supply one (no root available). */
const EMPTY_RUN_CONTEXT: RunContext = { data: {}, parent: {}, meta: {} };

/** Type guard: narrows `unknown` to a plain object (non-null, non-array, typeof 'object'). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rules the Rust validation engine (`crates/rune-engine/src/engine.rs`)
 * ACTUALLY implements. A schema built from only these rules can be validated
 * natively; anything else routes to the TS path (`rule.validate`).
 *
 * CRITICAL: a rule name here that the Rust engine does not implement is a
 * SILENT VALIDATION BYPASS — the engine's `_ => {}` arm skips unknown rules, so
 * the constraint never runs. Every entry MUST have a matching arm in engine.rs.
 * The TS chain rules (minLength/uuid/alpha/in/enum/range/…) live only in the TS
 * validator, so they are deliberately absent here.
 */
const STANDARD_RULES: ReadonlySet<string> = new Set([
	"string",
	"number",
	"boolean",
	"min",
	"max",
	"email",
	"positive",
	"minLength",
	"maxLength",
	"fixedLength",
	"uuid",
	"alpha",
	"alphaNumeric",
	"startsWith",
	"endsWith",
	"in",
	"notIn",
	"enum",
	"negative",
	"nonNegative",
	"range",
]);

/** Default messages for standard rules — used only for translator-key fallback. */
const STANDARD_MSGS: Readonly<Record<string, string>> = {
	string: "Must be a string",
	number: "Must be a number",
	boolean: "Must be a boolean",
	min: "Minimum",
	max: "Maximum",
	email: "Must be a valid email",
	positive: "Must be positive",
	minLength: "Too short",
	maxLength: "Too long",
	fixedLength: "Wrong length",
	alpha: "Must contain only letters",
	alphaNumeric: "Must contain only letters and numbers",
	startsWith: "Invalid prefix",
	endsWith: "Invalid suffix",
	uuid: "Must be a valid UUID",
	in: "Invalid value",
	notIn: "Invalid value",
	enum: "Invalid value",
	range: "Out of range",
	negative: "Must be negative",
	nonNegative: "Must be positive or zero",
};

const TYPE_RULE_NAMES: ReadonlySet<string> = new Set([
	"string",
	"number",
	"boolean",
	"object",
	"array",
]);
let validationTranslator: ValidationTranslator | undefined;

function hasCustomMessage(rule: RuleDef): boolean {
	return rule.hasCustomMessage === true;
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

/** Args carried on a rule, exposed to i18n/providers via message interpolation. */
function ruleArgs(rule: RuleDef): Record<string, unknown> | undefined {
	return rule.args;
}

/**
 * Resolve the final message for a failing rule. Precedence:
 *   1. explicit `.message()` override (always wins),
 *   2. a per-call {@link MessagesProviderContract} (VineJS parity),
 *   3. a globally bound translator (rune's rosetta superset),
 *   4. the rule's raw default message.
 */
function resolveRuleMessage(
	field: string,
	rule: RuleDef,
	ctx: RunContext,
): string {
	if (hasCustomMessage(rule)) {
		return rule.message;
	}

	const args = ruleArgs(rule);
	if (ctx.messagesProvider) {
		return ctx.messagesProvider.getMessage(
			rule.message,
			rule.name,
			field,
			args,
		);
	}

	if (!STANDARD_RULES.has(rule.name)) {
		return rule.message;
	}

	const params: ValidationMessageParams = { field };
	if (typeof rule.param === "number") {
		if (rule.name === "min" || rule.name === "minLength")
			params.min = rule.param;
		if (rule.name === "max" || rule.name === "maxLength")
			params.max = rule.param;
	}
	return resolveValidationMessage(
		`validation.${rule.name}`,
		rule.message,
		params,
	);
}

/** Resolve the "required" message through provider → translator → fallback. */
function resolveRequiredMessage(field: string, ctx: RunContext): string {
	if (ctx.messagesProvider) {
		return ctx.messagesProvider.getMessage(
			`${field} is required`,
			"required",
			field,
		);
	}
	return resolveValidationMessage(
		"validation.required",
		`${field} is required`,
		{ field },
	);
}

/** Compute once: does any field rule prevent dispatching to Rust? */
function detectHasCustomRules(fields: Record<string, RuleChain>): boolean {
	return Object.values(fields).some((chain) => {
		if (chain.useRules.length > 0) return true; // .use() rule — TS-only (Rust can't run JS)
		if (chain.asyncRules.length > 0) return true; // async rule — TS-only, needs validateAsync
		if (chain.hasConditionalRequired) return true; // requiredWhen — TS-only
		if (chain.preTransforms.length > 0) return true; // .parse() — TS-only
		if (chain.transforms.length > 0) return true; // .transform() — Rust gets only the NAME, can't run a JS fn
		if (chain.isNullable) return true; // .nullable() — the flag is not sent to the Rust engine
		return chain.rules.some((r) => {
			if (!STANDARD_RULES.has(r.name)) return true; // custom rule
			if (hasCustomMessage(r)) return true; // custom message
			return false;
		});
	});
}

/** Extract the phantom output type of a chain. */
type OutputOf<C> = C extends RuleChain<infer O> ? O : never;
/** Keys whose output includes `undefined` become optional in the inferred shape. */
type OptionalKeys<S> = {
	[K in keyof S]: undefined extends OutputOf<S[K]> ? K : never;
}[keyof S];
/** Flatten an intersection into a single readable object type. */
type Prettify<T> = { [K in keyof T]: T[K] } & unknown;

/**
 * Infer the validated data shape from a schema's field map — the type
 * `result.data` carries once `result.valid === true`. `rules.string()` →
 * `string`, `.optional()` → an optional key, `.nullable()` → `T | null`,
 * `.object(shape)`/`.array(item)` recurse.
 */
export type Infer<S> = Prettify<
	{
		[K in Exclude<keyof S, OptionalKeys<S>>]: OutputOf<S[K]>;
	} & {
		[K in OptionalKeys<S>]?: Exclude<OutputOf<S[K]>, undefined>;
	}
>;

/**
 * Create a validation schema.
 *
 * The field map's rule chains are phantom-typed, so `result.data` is inferred
 * automatically — `schema({ email: rules.string(), age: rules.number() })`
 * types `data` as `{ email: string; age: number }` with no manual generic.
 *
 *     const RegisterValidator = schema({
 *       email: rules.string().email(),
 *       age: rules.number().optional(),
 *     });
 *     // Infer<typeof RegisterValidator> not needed — result.data is typed.
 *
 * An explicit generic is still accepted for back-compat
 * (`schema<MyType>({ ... })`), overriding inference.
 */
export function schema<S extends Record<string, RuleChain>>(
	fields: S,
): ValidationSchema<Infer<S>>;
export function schema<T = Record<string, unknown>>(
	fields: Record<string, RuleChain>,
): ValidationSchema<T>;
export function schema(
	fields: Record<string, RuleChain>,
): ValidationSchema<Record<string, unknown>> {
	// Computed once at construction time, not per validate() call.
	const hasCustomRules = detectHasCustomRules(fields);
	// Any field carrying async rules (`unique`/`exists`/`useAsync`) forces callers
	// onto `validateAsync` — the sync path throws rather than silently skipping them.
	const hasAsyncRules = Object.values(fields).some(
		(chain) => chain.hasAsyncRulesDeep,
	);

	function validate(
		data: unknown,
		options?: ValidateOptions,
	): ValidationResult<Record<string, unknown>> {
		if (hasAsyncRules) {
			throw new Error(
				"rune: this schema has async rules (unique/exists/useAsync) — call validateAsync() instead of validate().",
			);
		}
		if (!isPlainObject(data)) {
			return {
				valid: false,
				errors: [
					{ field: "_root", rule: "type", message: "Input must be an object" },
				],
			};
		}

		const provider = options?.messagesProvider;
		if (!hasCustomRules && !validationTranslator && !provider) {
			if (isNativeAvailable()) {
				return validateWithRust(fields, data);
			}
			// This schema would have used the native engine, but it isn't loaded —
			// surface the platform-dependent TS fallback once instead of diverging
			// silently.
			warnNativeUnavailableOnce();
		}

		const errors: ValidationError[] = [];
		const validated: Record<string, unknown> = {};
		const rootCtx: RunContext = {
			data,
			parent: data,
			meta: options?.meta ?? {},
			messagesProvider: provider,
		};

		for (const [field, chain] of Object.entries(fields)) {
			const value = data[field];
			const result = chain._validateWithTransform(field, value, rootCtx);
			errors.push(...result.errors);
			// Gate on the TRANSFORMED result, not the raw input: a pre-transform
			// (`parse(() => 42)`) can produce a value for an absent field, and that
			// value must land in `data` — testing the raw `value` dropped it.
			if (result.errors.length === 0 && result.transformed !== undefined) {
				validated[field] = result.transformed;
			}
		}

		if (errors.length === 0) {
			return { valid: true, errors, data: validated };
		}
		return { valid: false, errors };
	}

	function validateOrThrow(
		data: unknown,
		options?: ValidateOptions,
	): Record<string, unknown> {
		const result = validate(data, options);
		if (result.valid) {
			return result.data;
		}
		throw new RuneValidationError(result.errors.map(toErrorNode));
	}

	async function validateAsync(
		data: unknown,
		options?: ValidateOptions,
	): Promise<ValidationResult<Record<string, unknown>>> {
		if (!isPlainObject(data)) {
			return {
				valid: false,
				errors: [
					{ field: "_root", rule: "type", message: "Input must be an object" },
				],
			};
		}
		const errors: ValidationError[] = [];
		const validated: Record<string, unknown> = {};
		const rootCtx: RunContext = {
			data,
			parent: data,
			meta: options?.meta ?? {},
			messagesProvider: options?.messagesProvider,
		};

		for (const [field, chain] of Object.entries(fields)) {
			// One collector per top-level field, drained straight away, so async
			// errors stay grouped with their field rather than piling up at the end.
			const pending: PendingAsync[] = [];
			const result = chain._validateWithTransform(
				field,
				data[field],
				rootCtx,
				pending,
			);
			const fieldErrors = [...result.errors];
			// The collector already applied the gate at every depth: a chain records
			// itself only when its own subtree passed and its value is present —
			// mirrors Lucid skipping a DB rule on an already-invalid or absent field.
			for (const task of pending) {
				const asyncErrors = await task.chain._runAsyncRules(
					task.field,
					task.value,
					task.ctx,
				);
				fieldErrors.push(...asyncErrors);
			}
			errors.push(...fieldErrors);
			if (fieldErrors.length === 0 && result.transformed !== undefined) {
				validated[field] = result.transformed;
			}
		}

		if (errors.length === 0) {
			return { valid: true, errors, data: validated };
		}
		return { valid: false, errors };
	}

	/**
	 * Non-throwing validation returning a `[error, null] | [null, data]` tuple
	 * (VineJS `tryValidate`), for when a failure is an expected code path.
	 */
	function tryValidate(
		data: unknown,
		options?: ValidateOptions,
	): [RuneValidationError, null] | [null, Record<string, unknown>] {
		const result = validate(data, options);
		if (result.valid) return [null, result.data];
		return [new RuneValidationError(result.errors.map(toErrorNode)), null];
	}

	/** Async counterpart of {@link tryValidate}. */
	async function tryValidateAsync(
		data: unknown,
		options?: ValidateOptions,
	): Promise<[RuneValidationError, null] | [null, Record<string, unknown>]> {
		const result = await validateAsync(data, options);
		if (result.valid) return [null, result.data];
		return [new RuneValidationError(result.errors.map(toErrorNode)), null];
	}

	async function validateOrThrowAsync(
		data: unknown,
		options?: ValidateOptions,
	): Promise<Record<string, unknown>> {
		const result = await validateAsync(data, options);
		if (result.valid) {
			return result.data;
		}
		throw new RuneValidationError(result.errors.map(toErrorNode));
	}

	return {
		fields,
		validate,
		validateOrThrow,
		validateAsync,
		validateOrThrowAsync,
		tryValidate,
		tryValidateAsync,
	};
}

/**
 * VineJS's `vine.create(...)`. Same thing as {@link schema} — the Adonis
 * spelling is provided so a validator reads the same in both frameworks.
 */
export const create = schema;

/** Map an internal {@link ValidationError} to a {@link RuneErrorNode}. */
function toErrorNode(error: ValidationError): RuneErrorNode {
	const node: RuneErrorNode = {
		message: error.message,
		rule: error.rule,
		field: error.field,
	};
	if (error.index !== undefined) node.index = error.index;
	if (error.meta !== undefined) node.meta = error.meta;
	return node;
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
	/** Interpolation args exposed to i18n/messages providers (e.g. `{ min: 3 }`). */
	args?: Record<string, unknown>;
	validate: (value: unknown) => boolean;
	message: string;
	/** Set when `.message()` overrode this rule's default text. */
	hasCustomMessage?: boolean;
}

/** A conditional-required condition (VineJS `requiredWhen` family). */
interface RequiredCondition {
	kind: "exists" | "missing" | "when";
	otherField: string;
	operator?: "=" | "!=" | ">" | "<" | ">=" | "<=" | "in" | "notIn";
	value?: unknown;
}

/** Phantom brand carrying the inferred output type (never assigned at runtime). */
declare const OUTPUT: unique symbol;

/** UUID (any version/variant) — identical to the Rust engine's pattern. */
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rule chain — fluent, phantom-typed validation builder. */
export class RuleChain<Output = unknown> {
	/** Phantom output type — drives {@link Infer}; never read at runtime. */
	declare readonly [OUTPUT]: Output;

	#rules: RuleDef[] = [];
	#isOptional = false;
	#isNullable = false;
	/**
	 * VineJS validates a field in bail mode by DEFAULT — it stops at that field's
	 * first failing rule (`FieldOptions.bail: true`). rune defaulted to `false`
	 * and reported every failing rule, which silently produced a different error
	 * array for the same schema. `.bail(false)` restores the exhaustive mode.
	 */
	#bail = true;
	#transforms: Array<{
		name: string;
		fn: (value: unknown, field: FieldContext) => unknown;
	}> = [];
	#preTransforms: Array<(value: unknown) => unknown> = [];
	/** Formats accepted by `date()` — also used to parse `afterField` siblings. */
	#dateFormats: DateFormat[] | null = null;
	#nestedSchema: Record<string, RuleChain> | null = null;
	#arrayItemChain: RuleChain | null = null;
	#recordValueChain: RuleChain | null = null;
	#tupleChains: RuleChain[] | null = null;
	#unionChains: RuleChain[] | null = null;
	#useRules: CompiledRule[] = [];
	#asyncRules: AsyncCompiledRule[] = [];
	/** Last rule added, whichever register it landed in — the `message()` target. */
	#lastRule:
		| { kind: "value"; ref: RuleDef }
		| { kind: "reporting"; ref: CompiledRule | AsyncCompiledRule }
		| null = null;
	/** `.message()` overrides for rules that report their own text from `run`. */
	#ruleMessages = new Map<CompiledRule | AsyncCompiledRule, string>();
	#requiredConditions: RequiredCondition[] = [];

	/** Public read access to rules (for OpenAPI generation, Rust bridge). */
	get rules(): readonly RuleDef[] {
		return this.#rules;
	}
	get isOptionalField(): boolean {
		return this.#isOptional;
	}
	/** Public read access to the `.nullable()` flag (keeps such schemas off the native path). */
	get isNullable(): boolean {
		return this.#isNullable;
	}
	get transforms(): ReadonlyArray<{
		name: string;
		fn: (value: unknown, field: FieldContext) => unknown;
	}> {
		return this.#transforms;
	}
	/** Public read access to `.use()` rules (used to keep such schemas off the native path). */
	get useRules(): readonly CompiledRule[] {
		return this.#useRules;
	}
	/** Public read access to async rules (`unique`/`exists`/`useAsync`) — run by `validateAsync`. */
	get asyncRules(): readonly AsyncCompiledRule[] {
		return this.#asyncRules;
	}
	/**
	 * Does this chain — or anything nested under it (object fields, array items) —
	 * carry async rules? The schema-level detection used to inspect only the
	 * top-level chains, so a nested `unique`/`exists` was invisible: `validate()`
	 * did not throw and `validateAsync()` never ran the rule, silently accepting
	 * an unchecked value.
	 */
	get hasAsyncRulesDeep(): boolean {
		if (this.#asyncRules.length > 0) return true;
		if (this.#nestedSchema) {
			for (const chain of Object.values(this.#nestedSchema)) {
				if (chain.hasAsyncRulesDeep) return true;
			}
		}
		if (this.#arrayItemChain?.hasAsyncRulesDeep) return true;
		if (this.#recordValueChain?.hasAsyncRulesDeep) return true;
		for (const chain of [
			...(this.#tupleChains ?? []),
			...(this.#unionChains ?? []),
		]) {
			if (chain.hasAsyncRulesDeep) return true;
		}
		return false;
	}
	/** Whether this chain stops at its first failing rule (VineJS `bail`). */
	get bails(): boolean {
		return this.#bail;
	}
	/** Public read access to `.parse()` pre-transforms (kept off the native path). */
	get preTransforms(): ReadonlyArray<(value: unknown) => unknown> {
		return this.#preTransforms;
	}
	/** Whether this chain carries a `requiredWhen`-family condition. */
	get hasConditionalRequired(): boolean {
		return this.#requiredConditions.length > 0;
	}

	/**
	 * Re-type this chain to a new phantom output while carrying its runtime state
	 * forward. Cast-free: `new RuleChain<U>()` is genuinely `RuleChain<U>` because
	 * the brand is `declare`-only. State arrays are copied so the abandoned source
	 * chain can't be mutated through the new one.
	 */
	#retype<U>(): RuleChain<U> {
		const next = new RuleChain<U>();
		next.#rules = [...this.#rules];
		next.#isOptional = this.#isOptional;
		next.#isNullable = this.#isNullable;
		next.#bail = this.#bail;
		next.#transforms = [...this.#transforms];
		next.#dateFormats = this.#dateFormats;
		next.#recordValueChain = this.#recordValueChain;
		next.#tupleChains = this.#tupleChains;
		next.#unionChains = this.#unionChains;
		next.#ruleMessages = new Map(this.#ruleMessages);
		next.#lastRule = this.#lastRule;
		next.#preTransforms = [...this.#preTransforms];
		next.#nestedSchema = this.#nestedSchema;
		next.#arrayItemChain = this.#arrayItemChain;
		next.#useRules = [...this.#useRules];
		next.#asyncRules = [...this.#asyncRules];
		next.#requiredConditions = [...this.#requiredConditions];
		return next;
	}

	/** Mark field as optional (absent / `undefined` allowed). */
	optional(): RuleChain<Output | undefined> {
		this.#isOptional = true;
		return this;
	}

	/** Mark field as nullable (`null` allowed, kept in the output). */
	nullable(): RuleChain<Output | null> {
		this.#isNullable = true;
		return this;
	}

	/** Mark field as both optional and nullable. */
	nullish(): RuleChain<Output | null | undefined> {
		this.#isOptional = true;
		this.#isNullable = true;
		return this;
	}

	/** Stop at the first failing rule for this field (VineJS bail). */
	bail(enabled = true): this {
		this.#bail = enabled;
		return this;
	}

	/** Must be an object matching a nested schema. */
	object<Sh extends Record<string, RuleChain>>(
		shape: Sh,
	): RuleChain<Infer<Sh>> {
		this.#pushRule({
			name: "object",
			validate: (v) => isPlainObject(v),
			message: "Must be an object",
		});
		this.#nestedSchema = shape;
		return this.#retype<Infer<Sh>>();
	}

	/** Must be an array. Items validated by the provided chain. */
	array<Item extends RuleChain>(itemChain?: Item): RuleChain<OutputOf<Item>[]> {
		this.#pushRule({
			name: "array",
			validate: (v) => Array.isArray(v),
			message: "Must be an array",
		});
		this.#arrayItemChain = itemChain ?? null;
		return this.#retype<OutputOf<Item>[]>();
	}

	/** Must be a string. */
	string(): RuleChain<string> {
		this.#pushRule({
			name: "string",
			validate: (v) => typeof v === "string",
			message: "Must be a string",
		});
		return this.#retype<string>();
	}

	/** Must be a number. */
	number(): RuleChain<number> {
		this.#pushRule({
			name: "number",
			validate: (v) =>
				typeof v === "number" && !Number.isNaN(v) && Number.isFinite(v),
			message: "Must be a number",
		});
		return this.#retype<number>();
	}

	/** Must be a boolean. */
	boolean(): RuleChain<boolean> {
		this.#pushRule({
			name: "boolean",
			validate: (v) => typeof v === "boolean",
			message: "Must be a boolean",
		});
		return this.#retype<boolean>();
	}

	/**
	 * Must be a date (VineJS `vine.date()`). ISO 8601 by default; pass `formats`
	 * for unix timestamps (`x` = ms, `X` = seconds) or a token format such as
	 * `DD/MM/YYYY`. Parsing is calendar-strict — `2026-02-31` is rejected.
	 *
	 * The validated output is a `Date`; bind {@link setDateTransform} to map it
	 * to your own type once at boot.
	 */
	date(options?: { formats?: DateFormat[] }): RuleChain<Date> {
		const formats = options?.formats ?? ["iso8601"];
		this.#dateFormats = formats;
		this.#pushRule({
			name: "date",
			args: { formats },
			validate: (v) => parseDateValue(v, formats) !== null,
			message: "Must be a valid date",
		});
		// Parse to a real `Date` BEFORE the comparison rules run, so `after`/
		// `before` never re-parse and never compare strings lexicographically.
		this.#transforms.push({
			name: "date",
			fn: (value) => parseDateValue(value, formats) ?? value,
		});
		return this.#retype<Date>();
	}

	/** Must be strictly after `operand` (`'today'`, an ISO string, or a `Date`). */
	after(operand: unknown): this {
		return this.#compareDate("after", operand, (a, b) => a > b);
	}

	/** Must be strictly before `operand`. */
	before(operand: unknown): this {
		return this.#compareDate("before", operand, (a, b) => a < b);
	}

	/** Must be after `operand`, or equal to it. */
	afterOrEqual(operand: unknown): this {
		return this.#compareDate("afterOrEqual", operand, (a, b) => a >= b);
	}

	/** Must be before `operand`, or equal to it. */
	beforeOrEqual(operand: unknown): this {
		return this.#compareDate("beforeOrEqual", operand, (a, b) => a <= b);
	}

	/** Must be after the date held by a sibling field (VineJS `afterField`). */
	afterField(otherField: string, options?: { compare?: "day" }): this {
		return this.#compareDateField(
			"afterField",
			otherField,
			options,
			(a, b) => a > b,
		);
	}

	/** Must be before the date held by a sibling field. */
	beforeField(otherField: string, options?: { compare?: "day" }): this {
		return this.#compareDateField(
			"beforeField",
			otherField,
			options,
			(a, b) => a < b,
		);
	}

	/** Must be the same instant as `operand` (VineJS `equals`). */
	equals(operand: unknown): this {
		return this.#compareDate("equals", operand, (a, b) => a === b);
	}

	/** Must be after the sibling's date, or the same instant (VineJS `afterOrSameAs`). */
	afterOrSameAs(otherField: string, options?: { compare?: "day" }): this {
		return this.#compareDateField(
			"afterOrSameAs",
			otherField,
			options,
			(a, b) => a >= b,
		);
	}

	/** Must be before the sibling's date, or the same instant. */
	beforeOrSameAs(otherField: string, options?: { compare?: "day" }): this {
		return this.#compareDateField(
			"beforeOrSameAs",
			otherField,
			options,
			(a, b) => a <= b,
		);
	}

	/** Must fall on a Saturday or Sunday (VineJS `weekend`). */
	weekend(): this {
		this.#pushRule({
			name: "weekend",
			validate: (v) =>
				v instanceof Date && (v.getDay() === 0 || v.getDay() === 6),
			message: "Must be a weekend date",
		});
		return this;
	}

	/** Must fall on a Monday-to-Friday day (VineJS `weekday`). */
	weekday(): this {
		this.#pushRule({
			name: "weekday",
			validate: (v) => v instanceof Date && v.getDay() > 0 && v.getDay() < 6,
			message: "Must be a weekday date",
		});
		return this;
	}

	/** Shared body of the `after`/`before`/`*OrEqual` literal comparisons. */
	#compareDate(
		name: string,
		operand: unknown,
		cmp: (a: number, b: number) => boolean,
	): this {
		this.#pushRule({
			name,
			args: { operand },
			validate: (v) => {
				const other = resolveOperand(operand);
				if (!(v instanceof Date) || other === null) return false;
				return cmp(v.getTime(), other.getTime());
			},
			message: `Must be ${name.replace(/([A-Z])/g, " $1").toLowerCase()} ${String(operand)}`,
		});
		return this;
	}

	/** Shared body of the `afterField`/`beforeField` sibling comparisons. */
	#compareDateField(
		name: string,
		otherField: string,
		options: { compare?: "day" } | undefined,
		cmp: (a: number, b: number) => boolean,
	): this {
		const formats = this.#dateFormats ?? ["iso8601"];
		const byDay = options?.compare === "day";
		this.#pushUse({
			__rune: "rule",
			run: (value, field) => {
				const other = parseDateValue(readSibling(field, otherField), formats);
				if (!(value instanceof Date) || other === null) {
					field.report(`Cannot compare with ${otherField}`, name);
					return;
				}
				const a = byDay ? startOfDay(value) : value;
				const b = byDay ? startOfDay(other) : other;
				if (!cmp(a.getTime(), b.getTime())) {
					field.report(
						`Must be ${name.replace("Field", "")} ${otherField}`,
						name,
					);
				}
			},
		});
		return this;
	}

	/**
	 * Must be an "accepted" value — `true`, `1`, `"1"`, `"on"`, `"yes"`,
	 * `"true"` (VineJS `accepted`, for checkbox-style consent fields).
	 */
	accepted(): RuleChain<true> {
		this.#pushRule({
			name: "accepted",
			validate: isAcceptedValue,
			message: "Must be accepted",
		});
		// Normalise ONLY an accepted value: a blanket `() => true` would rewrite a
		// refused value into an accepted one before the rule ever saw it.
		this.#transforms.push({
			name: "accepted",
			fn: (value) => (isAcceptedValue(value) ? true : value),
		});
		return this.#retype<true>();
	}

	/**
	 * Object with arbitrary keys, every value validated by `valueChain`
	 * (VineJS `record`).
	 */
	record<Item extends RuleChain>(
		valueChain: Item,
	): RuleChain<Record<string, OutputOf<Item>>> {
		this.#pushRule({
			name: "record",
			validate: (v) => isPlainObject(v),
			message: "Must be an object",
		});
		this.#recordValueChain = valueChain;
		return this.#retype<Record<string, OutputOf<Item>>>();
	}

	/**
	 * Fixed-length array with a schema per position (VineJS `tuple`). Extra
	 * items are rejected — a tuple that silently ignores a trailing element is
	 * how unvalidated data slips through.
	 */
	tuple<const Items extends readonly RuleChain[]>(
		items: Items,
	): RuleChain<{ [K in keyof Items]: OutputOf<Items[K]> }> {
		this.#pushRule({
			name: "tuple",
			args: { length: items.length },
			validate: (v) => Array.isArray(v) && v.length === items.length,
			message: `Must be an array of exactly ${items.length} items`,
		});
		this.#tupleChains = [...items];
		return this.#retype<{ [K in keyof Items]: OutputOf<Items[K]> }>();
	}

	/**
	 * Value must satisfy at least one of `chains`.
	 *
	 * Named deviation: VineJS's `vine.union` selects a branch with an explicit
	 * predicate (`vine.union.if(...)`) and reports that branch's errors. rune
	 * tries each branch and passes on the first match; when none matches it
	 * reports a single `union` error rather than the losing branches' errors,
	 * which would be noise attributable to no particular branch.
	 */
	union(chains: readonly RuleChain[]): this {
		this.#unionChains = [...chains];
		// Marker rule: its name is not in STANDARD_RULES, which is what keeps a
		// union off the native path. The Rust engine knows nothing about branches
		// and would silently accept anything.
		this.#pushRule({
			name: "union",
			validate: () => true,
			message: "Does not match any allowed shape",
		});
		return this;
	}

	/** Must equal one of `values` (enum). Narrows the output to the union. */
	enum<const V extends readonly (string | number | boolean)[]>(
		values: V,
	): RuleChain<V[number]> {
		const allowed = [...values];
		this.#pushRule({
			name: "enum",
			args: { values: allowed },
			validate: (v) => allowed.includes(asPrimitive(v)),
			message: "Invalid value",
		});
		return this.#retype<V[number]>();
	}

	/** Must equal a literal value. */
	literal<V extends string | number | boolean>(value: V): RuleChain<V> {
		this.#pushRule({
			name: "literal",
			args: { expectedValue: value },
			validate: (v) => v === value,
			message: `Must be ${String(value)}`,
		});
		return this.#retype<V>();
	}

	/** Minimum length (string) or minimum value (number). Alias of min/minLength. */
	min(n: number): this {
		this.#pushRule({
			name: "min",
			param: n,
			args: { min: n },
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

	/** Maximum length (string) or maximum value (number). Alias of max/maxLength. */
	max(n: number): this {
		this.#pushRule({
			name: "max",
			param: n,
			args: { max: n },
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

	/** Minimum length for a string or array (VineJS `minLength`). */
	minLength(n: number): this {
		this.#pushRule({
			name: "minLength",
			param: n,
			args: { min: n },
			validate: (v) => sizedLength(v) >= n,
			message: `Must have at least ${n} characters`,
		});
		return this;
	}

	/** Maximum length for a string or array (VineJS `maxLength`). */
	maxLength(n: number): this {
		this.#pushRule({
			name: "maxLength",
			param: n,
			args: { max: n },
			validate: (v) => {
				const len = sizedLength(v);
				return len >= 0 && len <= n;
			},
			message: `Must not exceed ${n} characters`,
		});
		return this;
	}

	/** Exact length for a string or array (VineJS `fixedLength`). */
	fixedLength(n: number): this {
		this.#pushRule({
			name: "fixedLength",
			param: n,
			args: { size: n },
			validate: (v) => sizedLength(v) === n,
			message: `Must be exactly ${n} characters`,
		});
		return this;
	}

	/** Must be a valid email. */
	email(): this {
		this.#pushRule({
			name: "email",
			// Mirror the Rust engine's regex exactly so the SAME schema validates
			// identically whether or not the native binary loaded.
			validate: (v) =>
				typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
			message: "Must be a valid email",
		});
		return this;
	}

	/** Must match a regular expression (TS-only — never dispatched to Rust). */
	regex(pattern: RegExp): this {
		this.#pushRule({
			name: "regex",
			validate: (v) => typeof v === "string" && pattern.test(v),
			message: "Invalid format",
		});
		return this;
	}

	/** Must be a valid URL (TS-only — uses the WHATWG URL parser). */
	url(): this {
		this.#pushRule({
			name: "url",
			validate: (v) => typeof v === "string" && isValidUrl(v),
			message: "Must be a valid URL",
		});
		return this;
	}

	/** Must be a valid UUID. */
	uuid(): this {
		this.#pushRule({
			name: "uuid",
			validate: (v) => typeof v === "string" && UUID_RE.test(v),
			message: "Must be a valid UUID",
		});
		return this;
	}

	/** Must be a ULID (VineJS `ulid`). */
	ulid(): this {
		return this.#stringRule("ulid", isUlid, "Must be a valid ULID");
	}

	/** Must be a JSON Web Token — three dot-separated base64url segments. */
	jwt(): this {
		return this.#stringRule("jwt", isJwt, "Must be a valid JWT");
	}

	/** Must contain only ASCII characters (VineJS `ascii`). */
	ascii(): this {
		return this.#stringRule(
			"ascii",
			isAscii,
			"Must contain only ASCII characters",
		);
	}

	/** Must be a CSS hex colour code, with or without the leading `#`. */
	hexCode(): this {
		return this.#stringRule("hexCode", isHexCode, "Must be a valid hex code");
	}

	/** Must be an IP address. Pass `version` to require v4 or v6 specifically. */
	ipAddress(options?: { version?: 4 | 6 }): this {
		const version = options?.version;
		return this.#stringRule(
			"ipAddress",
			(v) => isIpAddress(v, version),
			`Must be a valid IP address${version ? ` (v${version})` : ""}`,
			{ version },
		);
	}

	/** Must pass the Luhn checksum (VineJS `creditCard`). */
	creditCard(): this {
		return this.#stringRule(
			"creditCard",
			isCreditCard,
			"Must be a valid credit card number",
		);
	}

	/** Must be an IBAN passing the ISO 13616 mod-97 check. */
	iban(): this {
		return this.#stringRule("iban", isIban, "Must be a valid IBAN");
	}

	/** Must be a `"lat,lng"` pair within the valid ranges. */
	coordinates(): this {
		return this.#stringRule(
			"coordinates",
			isCoordinates,
			"Must be valid coordinates",
		);
	}

	/**
	 * Must be a mobile number in E.164 form. Named deviation from VineJS: rune
	 * carries no per-locale numbering plans, so there is no `locale` option.
	 */
	mobile(): this {
		return this.#stringRule(
			"mobile",
			isMobile,
			"Must be a valid mobile number",
		);
	}

	/**
	 * Must be a postal code for `countryCode`. Throws for a country rune has no
	 * pattern for, rather than accepting the value unchecked.
	 */
	postalCode(options: { countryCode: string }): this {
		const { countryCode } = options;
		if (isPostalCode("", countryCode) === null) {
			throw new RuneError(
				"UNSUPPORTED_COUNTRY",
				`postalCode(): no pattern for country '${countryCode}'.`,
				{
					hint: `Supported: ${SUPPORTED_POSTAL_CODES.join(", ")}. Use .regex() for others.`,
				},
			);
		}
		return this.#stringRule(
			"postalCode",
			(v) => isPostalCode(v, countryCode) === true,
			`Must be a valid ${countryCode.toUpperCase()} postal code`,
			{ countryCode },
		);
	}

	/** Must differ from a sibling field (VineJS `notSameAs`). */
	notSameAs(otherField: string): this {
		const formats = this.#dateFormats;
		this.#pushUse({
			__rune: "rule",
			run: (value, field) => {
				const other = readSibling(field, otherField);
				if (formats !== null && value instanceof Date) {
					const parsed = parseDateValue(other, formats);
					if (parsed !== null && parsed.getTime() === value.getTime()) {
						field.report(`Must be different from ${otherField}`, "notSameAs");
					}
					return;
				}
				if (value === other) {
					field.report(`Must be different from ${otherField}`, "notSameAs");
				}
			},
		});
		return this;
	}

	/** Array items must be unique — optionally compared on `field` (VineJS `distinct`). */
	distinct(field?: string): this {
		this.#pushRule({
			name: "distinct",
			args: { field },
			validate: (v) => {
				if (!Array.isArray(v)) return false;
				const keys = v.map((item) =>
					field !== undefined && isPlainObject(item)
						? JSON.stringify(item[field])
						: JSON.stringify(item),
				);
				return new Set(keys).size === keys.length;
			},
			message: field
				? `Items must have a unique ${field}`
				: "Items must be unique",
		});
		return this;
	}

	/** Number must have no fractional part (VineJS `withoutDecimals`). */
	withoutDecimals(): this {
		this.#pushRule({
			name: "withoutDecimals",
			validate: (v) => typeof v === "number" && Number.isInteger(v),
			message: "Must not have decimals",
		});
		return this;
	}

	/** Shared body of the string-format rules: reject non-strings, then check. */
	#stringRule(
		name: string,
		check: (value: string) => boolean,
		message: string,
		args?: Record<string, unknown>,
	): this {
		this.#pushRule({
			name,
			args,
			validate: (v) => typeof v === "string" && check(v),
			message,
		});
		return this;
	}

	/** Must be a passport number for `countryCode`. Throws for an uncovered country. */
	passport(options: { countryCode: string }): this {
		const { countryCode } = options;
		if (isPassport("", countryCode) === null) {
			throw new RuneError(
				"UNSUPPORTED_COUNTRY",
				`passport(): no pattern for country '${countryCode}'.`,
				{
					hint: `Supported: ${SUPPORTED_PASSPORTS.join(", ")}. Use .regex() for others.`,
				},
			);
		}
		return this.#stringRule(
			"passport",
			(v) => isPassport(v, countryCode) === true,
			`Must be a valid ${countryCode.toUpperCase()} passport number`,
			{ countryCode },
		);
	}

	/** Lowercase the value (VineJS `toLowerCase`). */
	toLowerCase(): this {
		return this.#stringMutation("toLowerCase", (v) => v.toLowerCase());
	}

	/** Uppercase the value (VineJS `toUpperCase`). */
	toUpperCase(): this {
		return this.#stringMutation("toUpperCase", (v) => v.toUpperCase());
	}

	/** Convert dash/snake/spaced words to camelCase (VineJS `toCamelCase`). */
	toCamelCase(): this {
		return this.#stringMutation("toCamelCase", toCamelCase);
	}

	/** HTML-escape `& < > " '` (VineJS `escape`). */
	escape(): this {
		return this.#stringMutation("escape", escapeHtml);
	}

	/** Normalise an email address (VineJS `normalizeEmail`). */
	normalizeEmail(options?: NormalizeEmailOptions): this {
		return this.#stringMutation("normalizeEmail", (v) =>
			normalizeEmail(v, options),
		);
	}

	/** Normalise a URL (VineJS `normalizeUrl`). */
	normalizeUrl(options?: NormalizeUrlOptions): this {
		return this.#stringMutation("normalizeUrl", (v) =>
			normalizeUrl(v, options),
		);
	}

	/** Shared body of the string mutations — non-strings pass through untouched. */
	#stringMutation(name: string, fn: (value: string) => string): this {
		this.#transforms.push({
			name,
			fn: (value) => (typeof value === "string" ? fn(value) : value),
		});
		return this;
	}

	/** Must contain only ASCII letters. */
	alpha(): this {
		this.#pushRule({
			name: "alpha",
			validate: (v) =>
				typeof v === "string" && v.length > 0 && /^[a-zA-Z]+$/.test(v),
			message: "Must contain only letters",
		});
		return this;
	}

	/** Must contain only ASCII letters and digits. */
	alphaNumeric(): this {
		this.#pushRule({
			name: "alphaNumeric",
			validate: (v) =>
				typeof v === "string" && v.length > 0 && /^[a-zA-Z0-9]+$/.test(v),
			message: "Must contain only letters and numbers",
		});
		return this;
	}

	/** String must start with `substring`. */
	startsWith(substring: string): this {
		this.#pushRule({
			name: "startsWith",
			args: { substring },
			validate: (v) => typeof v === "string" && v.startsWith(substring),
			message: `Must start with ${substring}`,
		});
		return this;
	}

	/** String must end with `substring`. */
	endsWith(substring: string): this {
		this.#pushRule({
			name: "endsWith",
			args: { substring },
			validate: (v) => typeof v === "string" && v.endsWith(substring),
			message: `Must end with ${substring}`,
		});
		return this;
	}

	/** Value must be one of `values`. */
	in(values: ReadonlyArray<string | number | boolean>): this {
		const allowed = [...values];
		this.#pushRule({
			name: "in",
			args: { values: allowed },
			validate: (v) => allowed.includes(asPrimitive(v)),
			message: "Invalid value",
		});
		return this;
	}

	/** Value must NOT be one of `values`. */
	notIn(values: ReadonlyArray<string | number | boolean>): this {
		const denied = [...values];
		this.#pushRule({
			name: "notIn",
			args: { values: denied },
			validate: (v) => !denied.includes(asPrimitive(v)),
			message: "Invalid value",
		});
		return this;
	}

	/** Number must be positive (> 0) and finite. */
	positive(): this {
		this.#pushRule({
			name: "positive",
			validate: (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
			message: "Must be positive",
		});
		return this;
	}

	/** Number must be negative (< 0) and finite. */
	negative(): this {
		this.#pushRule({
			name: "negative",
			validate: (v) => typeof v === "number" && Number.isFinite(v) && v < 0,
			message: "Must be negative",
		});
		return this;
	}

	/** Number must be >= 0 and finite. */
	nonNegative(): this {
		this.#pushRule({
			name: "nonNegative",
			validate: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
			message: "Must be positive or zero",
		});
		return this;
	}

	/** Number must fall within `[min, max]` (inclusive). */
	range(min: number, max: number): this {
		this.#pushRule({
			name: "range",
			args: { min, max },
			validate: (v) =>
				typeof v === "number" && Number.isFinite(v) && v >= min && v <= max,
			message: `Must be between ${min} and ${max}`,
		});
		return this;
	}

	/** Number must have at most `digits` decimal places (TS-only). */
	decimal(digits: number): this {
		this.#pushRule({
			name: "decimal",
			args: { digits },
			validate: (v) => {
				if (typeof v !== "number" || !Number.isFinite(v)) return false;
				const parts = String(v).split(".");
				return (parts[1]?.length ?? 0) <= digits;
			},
			message: `Must have at most ${digits} decimal places`,
		});
		return this;
	}

	/** Must equal a sibling field (VineJS `sameAs`). Cross-field → TS-only. */
	sameAs(otherField: string): this {
		const formats = this.#dateFormats;
		this.#pushUse({
			__rune: "rule",
			run: (value, field) => {
				const other = readSibling(field, otherField);
				// On a date chain the value is a parsed `Date` and the sibling is
				// still raw, so `!==` would compare a Date to a string and always
				// fail. Compare instants instead.
				if (formats !== null && value instanceof Date) {
					const parsed = parseDateValue(other, formats);
					if (parsed === null || parsed.getTime() !== value.getTime()) {
						field.report(`Must match ${otherField}`, "sameAs");
					}
					return;
				}
				if (value !== other) {
					field.report(`Must match ${otherField}`, "sameAs");
				}
			},
		});
		return this;
	}

	/** Must equal its `<field>_confirmation` sibling (VineJS `confirmed`). */
	confirmed(options?: { confirmationField?: string }): this {
		this.#pushUse({
			__rune: "rule",
			run: (value, field) => {
				const leaf = field.field.split(".").pop() ?? field.field;
				const other = options?.confirmationField ?? `${leaf}_confirmation`;
				if (value !== readSibling(field, other)) {
					field.report("Confirmation does not match", "confirmed");
				}
			},
		});
		return this;
	}

	/** Required only when `otherField` is present (non-null) — else optional. */
	requiredIfExists(otherField: string): this {
		this.#requiredConditions.push({ kind: "exists", otherField });
		return this;
	}

	/** Required only when `otherField` is absent/null — else optional. */
	requiredIfMissing(otherField: string): this {
		this.#requiredConditions.push({ kind: "missing", otherField });
		return this;
	}

	/** Required only when `otherField <op> value` holds — else optional. */
	requiredWhen(
		otherField: string,
		operator: RequiredCondition["operator"],
		value: unknown,
	): this {
		this.#requiredConditions.push({
			kind: "when",
			otherField,
			operator,
			value,
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

	/**
	 * Post-validation transform changing the output type (VineJS `transform`).
	 * `value` is `unknown` — narrow it in the callback (the no-cast rule forbids
	 * lying about a dynamically-produced value's static type).
	 */
	transform<U>(fn: (value: unknown, field: FieldContext) => U): RuleChain<U> {
		const next = this.#retype<U>();
		next.#transforms.push({ name: "transform", fn: (v, f) => fn(v, f) });
		return next;
	}

	/** Pre-validation transform of the raw input (VineJS `parse`). */
	parse(fn: (value: unknown) => unknown): this {
		this.#preTransforms.push(fn);
		return this;
	}

	/** Custom validation rule. */
	custom(
		name: string,
		validate: (value: unknown) => boolean,
		message?: string,
	): this {
		this.#pushRule({
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
		this.#pushUse(rule);
		return this;
	}

	/**
	 * Attach an async rule (from {@link createAsyncRule}). The schema must then be
	 * run with `validateAsync` — sync `validate()` throws for such a schema.
	 */
	useAsync(rule: AsyncCompiledRule): this {
		if (rule?.__rune !== "asyncRule" || typeof rule.run !== "function") {
			throw new RuneError(
				"INVALID_RULE",
				"useAsync() expects a compiled async rule — call the factory first",
				{ hint: "useAsync(myRule()) or useAsync(myRule(options))" },
			);
		}
		this.#pushAsync(rule);
		return this;
	}

	/**
	 * DB-backed uniqueness rule (Adonis Lucid `unique`). `check(value, field)`
	 * resolves `true` when the value is unique (valid). rune stays agnostic — the
	 * check does the query (e.g. against atlas). Requires `validateAsync`.
	 *
	 *     rules.string().email().unique(async (value) => {
	 *       const row = await db.from('users').where('email', value).first()
	 *       return !row
	 *     })
	 */
	unique(
		check: (value: unknown, field: FieldContext) => boolean | Promise<boolean>,
		message?: string,
	): this;
	unique(options: DatabaseRuleOptions, message?: string): this;
	unique(
		checkOrOptions:
			| ((value: unknown, field: FieldContext) => boolean | Promise<boolean>)
			| DatabaseRuleOptions,
		message?: string,
	): this {
		const check = toDatabaseCheck(checkOrOptions, "unique");
		this.#pushAsync({
			__rune: "asyncRule",
			async run(value: unknown, field: FieldContext): Promise<void> {
				const ok = await check(value, field);
				if (!ok) {
					field.report(
						message ?? `The ${field.field} has already been taken`,
						"database.unique",
					);
				}
			},
		});
		return this;
	}

	/**
	 * DB-backed existence rule (Adonis Lucid `exists`). `check(value, field)`
	 * resolves `true` when a matching row exists (valid). Requires `validateAsync`.
	 */
	exists(
		check: (value: unknown, field: FieldContext) => boolean | Promise<boolean>,
		message?: string,
	): this;
	exists(options: DatabaseRuleOptions, message?: string): this;
	exists(
		checkOrOptions:
			| ((value: unknown, field: FieldContext) => boolean | Promise<boolean>)
			| DatabaseRuleOptions,
		message?: string,
	): this {
		const check = toDatabaseCheck(checkOrOptions, "exists");
		this.#pushAsync({
			__rune: "asyncRule",
			async run(value: unknown, field: FieldContext): Promise<void> {
				const ok = await check(value, field);
				if (!ok) {
					field.report(
						message ?? `The selected ${field.field} is invalid`,
						"database.exists",
					);
				}
			},
		});
		return this;
	}

	/**
	 * Set a custom error message for the rule that was just added.
	 *
	 * "The last rule" spans all three registers: value rules (`#rules`),
	 * cross-field `.use()` rules (`sameAs`, `confirmed`, `afterField`,
	 * `notSameAs`) and async rules (`unique`, `exists`, `useAsync`). Targeting
	 * `#rules` alone silently retargeted the PREVIOUS value rule — or threw
	 * `NO_RULE` — whenever the preceding call was a cross-field or async rule.
	 */
	message(msg: string): this {
		const target = this.#lastRule;
		if (!target) {
			throw new RuneError("NO_RULE", "message() must be called after a rule");
		}
		if (target.kind === "value") {
			target.ref.message = msg;
			target.ref.hasCustomMessage = true;
		} else {
			// `.use()` / async rules report their own text from inside `run`, so the
			// override is applied when the rule reports rather than stored on it.
			this.#ruleMessages.set(target.ref, msg);
		}
		return this;
	}

	/**
	 * Build the {@link FieldContext} handed to `.use()` / async rules. Shared so
	 * the sync and async paths cannot drift on what a rule can see.
	 */
	#makeFieldContext(
		field: string,
		value: unknown,
		ctx: RunContext,
		errors: ValidationError[],
		onMutate: (next: unknown) => void,
	): FieldContext {
		const segments = field.split(".");
		return {
			value,
			data: ctx.data,
			parent: ctx.parent,
			field,
			meta: ctx.meta,
			isValid: errors.length === 0,
			name: segments[segments.length - 1] ?? field,
			wildCardPath: toWildcardPath(field),
			isArrayMember: Array.isArray(ctx.parent),
			isDefined: value !== undefined && value !== null,
			isValidDataType: errors.length === 0,
			getFieldPath: () => field,
			mutate: onMutate,
			report(
				message: string,
				rule: string,
				reportedField?: string,
				args?: Record<string, unknown>,
			): void {
				errors.push({
					field: reportedField ?? field,
					rule,
					message,
					...(args ? { meta: args } : {}),
				});
			},
		};
	}

	/**
	 * Run only the implicit `.use()` rules against an absent value. A rule
	 * declared `{ implicit: true }` exists to police `undefined`/`null`, so the
	 * early return for optional fields must not skip it.
	 */
	#runImplicitRules(
		field: string,
		value: unknown,
		ctx: RunContext,
	): ValidationError[] {
		const implicitRules = this.#useRules.filter((rule) => rule.implicit);
		if (implicitRules.length === 0) return [];
		const errors: ValidationError[] = [];
		const fieldCtx = this.#makeFieldContext(
			field,
			value,
			ctx,
			errors,
			() => {},
		);
		for (const rule of implicitRules) {
			fieldCtx.isValid = errors.length === 0;
			rule.run(value, fieldCtx);
		}
		return errors;
	}

	/** Add a value rule and remember it as the `message()` target. */
	#pushRule(rule: RuleDef): void {
		this.#rules.push(rule);
		this.#lastRule = { kind: "value", ref: rule };
	}

	/** Add a cross-field `.use()` rule and remember it as the `message()` target. */
	#pushUse(rule: CompiledRule): void {
		this.#useRules.push(rule);
		this.#lastRule = { kind: "reporting", ref: rule };
	}

	/** Add an async rule and remember it as the `message()` target. */
	#pushAsync(rule: AsyncCompiledRule): void {
		this.#asyncRules.push(rule);
		this.#lastRule = { kind: "reporting", ref: rule };
	}

	/** Whether the field is required given the surrounding data (conditionals). */
	#isRequired(ctx: RunContext): boolean {
		if (this.#requiredConditions.length === 0) return true;
		return this.#requiredConditions.some((cond) =>
			evalRequiredCondition(cond, ctx),
		);
	}

	/**
	 * Internal: validate a field value and return errors + transformed value.
	 *
	 * `pending` is the async-rule collector. The traversal itself stays sync (it
	 * is shared with `validate()`); when a collector is supplied, every chain in
	 * the tree that carries async rules and passed its sync rules records itself
	 * for `validateAsync` to await. Without it, nested async rules never ran.
	 */
	_validateWithTransform(
		field: string,
		rawValue: unknown,
		ctx: RunContext = EMPTY_RUN_CONTEXT,
		pending?: PendingAsync[],
	): { errors: ValidationError[]; transformed: unknown } {
		// 0. Pre-validation parse() transforms run on the raw value first.
		let value = rawValue;
		for (const pre of this.#preTransforms) {
			value = pre(value);
		}

		if (value === undefined) {
			if (this.#isOptional || !this.#isRequired(ctx)) {
				// Implicit rules are precisely the ones that must see an absent value.
				return {
					errors: this.#runImplicitRules(field, value, ctx),
					transformed: value,
				};
			}
			return { errors: [this.#requiredError(field, ctx)], transformed: value };
		}
		if (value === null) {
			// VineJS split, now matched exactly: `nullable()` accepts null AND keeps
			// it in the output; `optional()` accepts null but DROPS the key. rune
			// used to keep null in both cases, so an optional field silently added
			// `key: null` to a payload VineJS would have left without the key.
			if (this.#isNullable) {
				return {
					errors: this.#runImplicitRules(field, value, ctx),
					transformed: value,
				};
			}
			if (this.#isOptional || !this.#isRequired(ctx)) {
				return {
					errors: this.#runImplicitRules(field, value, ctx),
					transformed: undefined,
				};
			}
			return { errors: [this.#requiredError(field, ctx)], transformed: value };
		}

		// 1. Type rules first on the raw value — bail on type mismatch.
		const typeError = this.#runTypeRules(field, value, ctx);
		if (typeError) return { errors: [typeError], transformed: value };

		// 2. Apply transforms (trim, etc.), then run value rules on the result.
		let transformed = this.#applyTransformsTo(value, field, ctx);
		const errors = this.#runValueRules(field, transformed, ctx);

		// 3. Vine-style .use() rules — run with a FieldContext exposing the root
		//    `data` and `parent`, so a rule can validate across fields.
		if (this.#useRules.length > 0 && !(this.#bail && errors.length > 0)) {
			// `.use()` rules may call `field.mutate()`, so the value can change here.
			transformed = this.#runUseRules(field, transformed, ctx, errors);
		}

		// 3b. Date output mapping (VineJS `VineDate.transform`). Deliberately AFTER
		//     the comparison rules so `after`/`before`/`afterField` always see a
		//     real `Date`, whatever type the consumer maps it to.
		if (
			this.#dateFormats !== null &&
			dateOutputTransform !== null &&
			transformed instanceof Date
		) {
			transformed = dateOutputTransform(transformed);
		}

		// 4. Nested object validation (only if type check passed — not arrays)
		if (this.#nestedSchema && isPlainObject(transformed)) {
			const obj: Record<string, unknown> = { ...transformed };
			transformed = obj;
			for (const [nestedField, chain] of Object.entries(this.#nestedSchema)) {
				const nestedResult = chain._validateWithTransform(
					`${field}.${nestedField}`,
					obj[nestedField],
					{ ...ctx, parent: obj },
					pending,
				);
				errors.push(...nestedResult.errors);
				if (nestedResult.transformed !== undefined) {
					obj[nestedField] = nestedResult.transformed;
				}
			}
		}

		// 4b. Record values — same shape as the nested-object walk, arbitrary keys.
		if (this.#recordValueChain && isPlainObject(transformed)) {
			const obj: Record<string, unknown> = { ...transformed };
			transformed = obj;
			for (const key of Object.keys(obj)) {
				const res = this.#recordValueChain._validateWithTransform(
					`${field}.${key}`,
					obj[key],
					{ ...ctx, parent: obj },
					pending,
				);
				errors.push(...res.errors);
				if (res.transformed !== undefined) obj[key] = res.transformed;
			}
		}

		// 4c. Tuple positions — length was already enforced by the `tuple` rule.
		if (this.#tupleChains && Array.isArray(transformed)) {
			const arr: unknown[] = [...transformed];
			transformed = arr;
			this.#tupleChains.forEach((chain, i) => {
				const res = chain._validateWithTransform(
					`${field}.${i}`,
					arr[i],
					{ ...ctx, parent: arr },
					pending,
				);
				for (const e of res.errors) if (e.index === undefined) e.index = i;
				errors.push(...res.errors);
				if (res.transformed !== undefined) arr[i] = res.transformed;
			});
		}

		// 4d. Union — first branch that validates wins; its transform is kept.
		if (this.#unionChains) {
			let matched = false;
			for (const branch of this.#unionChains) {
				const res = branch._validateWithTransform(field, transformed, ctx);
				if (res.errors.length === 0) {
					transformed = res.transformed;
					matched = true;
					break;
				}
			}
			if (!matched) {
				errors.push({
					field,
					rule: "union",
					message: resolveRuleMessage(
						field,
						{
							name: "union",
							validate: () => false,
							message: "Does not match any allowed shape",
						},
						ctx,
					),
				});
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
					{ ...ctx, parent: arr },
					pending,
				);
				for (const e of itemResult.errors) {
					if (e.index === undefined) e.index = i;
				}
				errors.push(...itemResult.errors);
				if (itemResult.transformed !== undefined) {
					arr[i] = itemResult.transformed;
				}
			}
		}

		// 6. Record this chain's async rules for `validateAsync` to await. Mirrors
		//    Lucid skipping a DB rule on an already-invalid or absent field: only a
		//    clean, present value is worth a round-trip.
		if (
			pending &&
			this.#asyncRules.length > 0 &&
			errors.length === 0 &&
			transformed !== undefined &&
			transformed !== null
		) {
			pending.push({ chain: this, field, value: transformed, ctx });
		}

		return { errors, transformed };
	}

	/** Run `.use()` rules on the transformed value with a fresh FieldContext. */
	#runUseRules(
		field: string,
		transformed: unknown,
		ctx: RunContext,
		errors: ValidationError[],
	): unknown {
		// Set per iteration so `report` can substitute the `.message()` override of
		// the rule currently running — these rules carry their text inside `run`.
		let override: string | undefined;
		let current = transformed;
		const fieldCtx = this.#makeFieldContext(
			field,
			transformed,
			ctx,
			errors,
			(next) => {
				current = next;
				fieldCtx.value = next;
			},
		);
		const report = fieldCtx.report.bind(fieldCtx);
		fieldCtx.report = (message, rule, reportedField, args) =>
			report(override ?? message, rule, reportedField, args);
		for (const rule of this.#useRules) {
			// A non-implicit rule is skipped on an absent value (VineJS semantics);
			// `implicit: true` is what lets a custom rule police undefined/null.
			if (!rule.implicit && (current === undefined || current === null))
				continue;
			fieldCtx.isValid = errors.length === 0;
			fieldCtx.isDefined = current !== undefined && current !== null;
			override = this.#ruleMessages.get(rule);
			rule.run(current, fieldCtx);
		}
		return current;
	}

	/**
	 * Run this chain's async rules on the (already sync-validated) value, awaiting
	 * each in order. Returns the errors they reported. Used by `validateAsync`.
	 * @internal
	 */
	async _runAsyncRules(
		field: string,
		transformed: unknown,
		ctx: RunContext,
	): Promise<ValidationError[]> {
		const errors: ValidationError[] = [];
		let override: string | undefined;
		let current = transformed;
		const fieldCtx = this.#makeFieldContext(
			field,
			transformed,
			ctx,
			errors,
			(next) => {
				current = next;
				fieldCtx.value = next;
			},
		);
		const report = fieldCtx.report.bind(fieldCtx);
		fieldCtx.report = (message, rule, reportedField, args) =>
			report(override ?? message, rule, reportedField, args);
		for (const rule of this.#asyncRules) {
			if (!rule.implicit && (current === undefined || current === null))
				continue;
			fieldCtx.isValid = errors.length === 0;
			fieldCtx.isDefined = current !== undefined && current !== null;
			override = this.#ruleMessages.get(rule);
			await rule.run(current, fieldCtx);
		}
		return errors;
	}

	#requiredError(field: string, ctx: RunContext): ValidationError {
		return {
			field,
			rule: "required",
			message: resolveRequiredMessage(field, ctx),
		};
	}

	/** Run the type rules (string/number/…) on the raw value; first failure bails. */
	#runTypeRules(
		field: string,
		value: unknown,
		ctx: RunContext,
	): ValidationError | null {
		for (const rule of this.#rules) {
			if (TYPE_RULE_NAMES.has(rule.name) && !rule.validate(value)) {
				return {
					field,
					rule: rule.name,
					message: resolveRuleMessage(field, rule, ctx),
					...(ruleArgs(rule) ? { meta: ruleArgs(rule) } : {}),
				};
			}
		}
		return null;
	}

	/** Run the non-type rules (min/max/email/…) on the transformed value. */
	#runValueRules(
		field: string,
		transformed: unknown,
		ctx: RunContext,
	): ValidationError[] {
		const errors: ValidationError[] = [];
		for (const rule of this.#rules) {
			if (TYPE_RULE_NAMES.has(rule.name)) continue;
			if (this.#bail && errors.length > 0) break;
			if (!rule.validate(transformed)) {
				errors.push({
					field,
					rule: rule.name,
					message: resolveRuleMessage(field, rule, ctx),
					...(ruleArgs(rule) ? { meta: ruleArgs(rule) } : {}),
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
		return this.#applyTransformsTo(value, "", EMPTY_RUN_CONTEXT);
	}

	#applyTransformsTo(value: unknown, field: string, ctx: RunContext): unknown {
		let result = value;
		for (const transform of this.#transforms) {
			LAST_FIELD.value = result;
			LAST_FIELD.data = ctx.data;
			LAST_FIELD.parent = ctx.parent;
			LAST_FIELD.field = field;
			LAST_FIELD.meta = ctx.meta;
			result = transform.fn(result, LAST_FIELD);
		}
		return result;
	}
}

/**
 * Scratch FieldContext reused for `.transform()` callbacks — transforms run
 * inline in {@link RuleChain.#applyTransformsTo}, which repopulates it before
 * each call. A shared object avoids per-transform allocation; it is never
 * retained across calls.
 */
const LAST_FIELD: FieldContext = {
	value: undefined,
	data: {},
	parent: {},
	field: "",
	meta: {},
	isValid: true,
	name: "",
	wildCardPath: "",
	isArrayMember: false,
	isDefined: false,
	isValidDataType: true,
	getFieldPath: () => "",
	mutate: (): void => {},
	report(): void {},
};

/** Coerce a value to a comparable primitive for `in`/`enum` membership. */
function asPrimitive(value: unknown): string | number | boolean {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	// Non-primitive values can never be a member of a primitive set; return a
	// sentinel that no allowed entry equals.
	return Symbol.iterator.toString();
}

/** Code-point length for a string, element count for an array, else -1. */
function sizedLength(value: unknown): number {
	if (typeof value === "string") return [...value].length;
	if (Array.isArray(value)) return value.length;
	return -1;
}

/** WHATWG URL validity — accepts only http/https to avoid `mailto:` etc. */
function isValidUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/** Read a sibling field's value from the immediate parent (object only). */
function readSibling(field: FieldContext, name: string): unknown {
	const parent = field.parent;
	if (Array.isArray(parent)) return undefined;
	return parent[name];
}

/** Evaluate whether a `requiredWhen`-family condition makes the field required. */
function evalRequiredCondition(
	cond: RequiredCondition,
	ctx: RunContext,
): boolean {
	const other = isPlainObject(ctx.parent)
		? ctx.parent[cond.otherField]
		: ctx.data[cond.otherField];
	const present = other !== undefined && other !== null;

	if (cond.kind === "exists") return present;
	if (cond.kind === "missing") return !present;

	switch (cond.operator) {
		case "=":
			return other === cond.value;
		case "!=":
			return other !== cond.value;
		case ">":
			return typeof other === "number" && typeof cond.value === "number"
				? other > cond.value
				: false;
		case "<":
			return typeof other === "number" && typeof cond.value === "number"
				? other < cond.value
				: false;
		case ">=":
			return typeof other === "number" && typeof cond.value === "number"
				? other >= cond.value
				: false;
		case "<=":
			return typeof other === "number" && typeof cond.value === "number"
				? other <= cond.value
				: false;
		case "in":
			return Array.isArray(cond.value) && cond.value.includes(other);
		case "notIn":
			return Array.isArray(cond.value) && !cond.value.includes(other);
		default:
			return false;
	}
}

/** No-op alias of {@link schema} — VineJS `vine.compile()` API parity. */
export function compile<T extends ValidationSchema>(s: T): T {
	return s;
}

/** Entry point for building rules. */
export const rules = {
	string: (): RuleChain<string> => new RuleChain().string(),
	number: (): RuleChain<number> => new RuleChain().number(),
	boolean: (): RuleChain<boolean> => new RuleChain().boolean(),
	any: (): RuleChain<unknown> => new RuleChain(),
	date: (options?: { formats?: DateFormat[] }): RuleChain<Date> =>
		new RuleChain().date(options),
	accepted: (): RuleChain<true> => new RuleChain().accepted(),
	record: <Item extends RuleChain>(
		valueChain: Item,
	): RuleChain<Record<string, OutputOf<Item>>> =>
		new RuleChain().record(valueChain),
	tuple: <const Items extends readonly RuleChain[]>(
		items: Items,
	): RuleChain<{ [K in keyof Items]: OutputOf<Items[K]> }> =>
		new RuleChain().tuple(items),
	union: (chains: readonly RuleChain[]): RuleChain =>
		new RuleChain().union(chains),
	object: <Sh extends Record<string, RuleChain>>(
		shape: Sh,
	): RuleChain<Infer<Sh>> => new RuleChain().object(shape),
	array: <Item extends RuleChain>(item?: Item): RuleChain<OutputOf<Item>[]> =>
		new RuleChain().array(item),
	enum: <const V extends readonly (string | number | boolean)[]>(
		values: V,
	): RuleChain<V[number]> => new RuleChain().enum(values),
	literal: <V extends string | number | boolean>(value: V): RuleChain<V> =>
		new RuleChain().literal(value),
};

/** Serialize schema + data and validate via Rust NAPI. */
function validateWithRust(
	fields: Record<string, RuleChain>,
	data: Record<string, unknown>,
): ValidationResult<Record<string, unknown>> {
	const schemaDesc: Record<
		string,
		{
			rules: Array<{ name: string; params: unknown }>;
			optional: boolean;
			transforms: string[];
			bail: boolean;
		}
	> = {};

	for (const [field, chain] of Object.entries(fields)) {
		const ruleDescs = chain.rules.map((r) => ({
			name: r.name,
			// Serialize THIS rule's own args (per-rule, so min(3).min(5) keeps both
			// bounds — a find-first lookup previously collapsed them).
			params: r.args ?? null,
		}));
		schemaDesc[field] = {
			rules: ruleDescs,
			optional: chain.isOptionalField,
			transforms: chain.transforms.map((t) => t.name),
			// Sent explicitly so the Rust engine and the TS path agree on bail.
			bail: chain.bails,
		};
	}

	const request = JSON.stringify({ schema: schemaDesc, data });
	const native = validateNative(request);
	if (native.valid && native.data !== undefined) {
		return { valid: true, errors: native.errors, data: native.data };
	}
	return { valid: false, errors: native.errors };
}
