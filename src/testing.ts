/**
 * Test helpers for custom rules.
 *
 * A rule built with `createRule` / `createAsyncRule` is a plain object with a
 * `run(value, field)` — but running one by hand means building a
 * {@link FieldContext} first, and getting that wrong is how a rule ends up
 * tested against a context no validation ever produces. These helpers build the
 * real thing and collect what the rule reported.
 *
 * ```ts
 * import { runRule, fieldContext } from "@c9up/rune/testing"
 *
 * const result = runRule(isEven(), 3)
 * expect(result.valid).toBe(false)
 * expect(result.errors[0]?.rule).toBe("isEven")
 * ```
 */

import { RuneError } from "./errors.js";
import type {
	AsyncCompiledRule,
	CompiledRule,
	FieldContext,
	ValidationError,
} from "./Schema.js";

/** What a rule saw and what it did about it. */
export interface RuleRunResult {
	/** `true` when the rule reported nothing. */
	valid: boolean;
	/** Everything the rule reported, in order. */
	errors: ValidationError[];
	/** The value after any `field.mutate()` — the input otherwise. */
	value: unknown;
}

/** How to shape the field a rule is handed. */
export interface FieldContextOptions {
	/** Dotted path. Defaults to `"field"`. Drives `name` and `wildCardPath`. */
	path?: string;
	/** The whole payload, for a rule that reads siblings. Defaults to `{}`. */
	data?: Record<string, unknown>;
	/** The immediate parent. Defaults to `data`. */
	parent?: Record<string, unknown> | unknown[];
	/** `validate(data, { meta })` metadata. Defaults to `{}`. */
	meta?: Record<string, unknown>;
	/** Whether earlier rules already passed. Defaults to `true`. */
	isValid?: boolean;
	/** Whether the value passed its type rule. Defaults to `isValid`. */
	isValidDataType?: boolean;
	/** Called for each `field.report(...)`. */
	onReport?: (error: ValidationError) => void;
	/** Called for `field.mutate(next)`. */
	onMutate?: (next: unknown) => void;
}

/** Last path segment — a NUMBER for an array index, as rune's runtime does. */
function nameOf(path: string): string | number {
	const segments = path.split(".");
	const last = segments[segments.length - 1];
	if (last === undefined) return path;
	return /^\d+$/.test(last) ? Number(last) : last;
}

/** Numeric segments replaced by `*`, as rune's runtime does. */
function wildcardOf(path: string): string {
	return path
		.split(".")
		.map((segment) => (/^\d+$/.test(segment) ? "*" : segment))
		.join(".");
}

/**
 * Build the {@link FieldContext} a rule would receive during a real run.
 *
 * Use it when the rule needs a context you cannot express through
 * {@link runRule}'s options — otherwise `runRule` builds one for you.
 */
export function fieldContext(
	value: unknown,
	options: FieldContextOptions = {},
): FieldContext {
	const path = options.path ?? "field";
	const data = options.data ?? {};
	const parent = options.parent ?? data;
	const isValid = options.isValid ?? true;
	let current = value;
	return {
		get value() {
			return current;
		},
		data,
		parent,
		field: path,
		meta: options.meta ?? {},
		isValid,
		name: nameOf(path),
		wildCardPath: wildcardOf(path),
		isArrayMember: Array.isArray(parent),
		isDefined: value !== undefined && value !== null,
		isValidDataType: options.isValidDataType ?? isValid,
		getFieldPath: () => path,
		mutate(next: unknown): void {
			current = next;
			options.onMutate?.(next);
		},
		report(
			message: string,
			rule: string,
			reportedField?: string | FieldContext,
			args?: Record<string, unknown>,
		): void {
			// A rule may report against ANOTHER field — `sameAs` blames the
			// confirmation, not the password. Dropping the third argument made the
			// helper disagree with the runtime it exists to stand in for, which is
			// the one thing a test helper must never do.
			const target =
				typeof reportedField === "string"
					? reportedField
					: (reportedField?.getFieldPath() ?? path);
			options.onReport?.({
				field: target,
				rule,
				message,
				...(args ? { meta: args } : {}),
			});
		},
	};
}

/** Shared body: build the context, collect what the rule reports. */
function prepare(
	value: unknown,
	options: FieldContextOptions,
): { errors: ValidationError[]; field: FieldContext; read: () => unknown } {
	const errors: ValidationError[] = [];
	let mutated = value;
	const field = fieldContext(value, {
		...options,
		onReport: (error) => {
			errors.push(error);
			options.onReport?.(error);
		},
		onMutate: (next) => {
			mutated = next;
			options.onMutate?.(next);
		},
	});
	return { errors, field, read: () => mutated };
}

/**
 * Run a synchronous rule against `value`.
 *
 * Refuses an async rule rather than reporting a pass it never waited for —
 * the same bypass `createRule`'s async detection exists to close, and the same
 * shape as `validateResult()` refusing a schema that carries async rules.
 *
 * The union is deliberate: a JavaScript caller has no compile-time barrier, and
 * a rule pulled from a registry is only known at runtime.
 */
export function runRule(
	rule: CompiledRule | AsyncCompiledRule,
	value: unknown,
	options: FieldContextOptions = {},
): RuleRunResult {
	if (rule.__rune !== "rule") {
		throw new RuneError(
			"ASYNC_RULE_NOT_AWAITED",
			"runRule() cannot run an async rule: its verdict would arrive after the call returned.",
			{ hint: "Use runRuleAsync()." },
		);
	}
	const { errors, field, read } = prepare(value, options);
	rule.run(value, field);
	return { valid: errors.length === 0, errors, value: read() };
}

/** Run a rule against `value`, awaiting it. Accepts a sync rule too. */
export async function runRuleAsync(
	rule: CompiledRule | AsyncCompiledRule,
	value: unknown,
	options: FieldContextOptions = {},
): Promise<RuleRunResult> {
	const { errors, field, read } = prepare(value, options);
	await rule.run(value, field);
	return { valid: errors.length === 0, errors, value: read() };
}
