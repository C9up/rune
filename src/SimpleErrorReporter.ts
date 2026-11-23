/**
 * Upstream's simple error reporter: it collects each failure as a
 * `{ message, rule, field, index?, meta? }` node and turns the batch into an
 * `E_VALIDATION_ERROR`.
 *
 * Pass it, or a subclass, as `errorReporter: () => new SimpleErrorReporter()`
 * to start from upstream's reporter and change one method.
 */
import { E_VALIDATION_ERROR, type RuneErrorNode } from "./errors.js";
import type { ErrorReporterContract, FieldContext } from "./Schema.js";

export class SimpleErrorReporter implements ErrorReporterContract {
	/** `true` once at least one error has been reported. */
	hasErrors = false;

	/** Every failure reported so far, in report order. */
	errors: RuneErrorNode[] = [];

	/**
	 * Record one failure. `field` is the failing field's context (its path is
	 * read off `getFieldPath()`), or the dotted path itself.
	 */
	report(
		message: string,
		rule: string,
		field: FieldContext | string,
		meta?: Record<string, unknown>,
	): void {
		const error: RuneErrorNode = {
			message,
			rule,
			field: typeof field === "string" ? field : field.getFieldPath(),
		};
		if (meta) error.meta = meta;
		if (
			typeof field !== "string" &&
			field.isArrayMember &&
			typeof field.name === "number"
		) {
			error.index = field.name;
		}
		this.hasErrors = true;
		this.errors.push(error);
	}

	/** The exception holding every reported failure. */
	createError(): E_VALIDATION_ERROR {
		return new E_VALIDATION_ERROR(this.errors);
	}
}
