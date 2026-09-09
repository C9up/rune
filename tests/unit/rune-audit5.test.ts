import { describe, expect, it } from "vitest";
import type { NormalizeUrlOptions, RuleValidator } from "../../src/index.js";
import rune, {
	create,
	createRule,
	RuneError,
	RuneValidationError,
	rules,
	SimpleMessagesProvider,
	schema,
	setValidationTranslator,
} from "../../src/index.js";

/** Narrow away null/undefined without a `!` assertion (which lies to the compiler). */
function defined<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("expected a defined value");
	return value;
}

describe("rune > audit 5", () => {
	it("nested objects DROP undeclared keys unless allowUnknownProperties()", () => {
		// The mass-assignment guarantee held at the top level but not one level
		// down: the nested walk spread the input, so an undeclared `isAdmin`
		// survived into the validated payload.
		const strict = schema({
			user: rules.any().object({ name: rules.string() }),
		});
		const out = strict.validateOrThrow({
			user: { name: "Ada", isAdmin: true },
		});
		expect(out.user).toEqual({ name: "Ada" });

		const lax = schema({
			user: rules
				.any()
				.object({ name: rules.string() })
				.allowUnknownProperties(),
		});
		expect(
			lax.validateOrThrow({ user: { name: "Ada", isAdmin: true } }).user,
		).toEqual({ name: "Ada", isAdmin: true });
	});

	it("file() reads Adonis size spellings and refuses an unreadable one", () => {
		const s = schema({ doc: rules.file({ size: "2mb" }) });
		expect(s.validateResult({ doc: { size: 1_000_000 } }).valid).toBe(true);
		expect(s.validateResult({ doc: { size: 3_000_000 } }).valid).toBe(false);
		expect(
			schema({ d: rules.file({ size: "512kb" }) }).validateResult({
				d: { size: 600_000 },
			}).valid,
		).toBe(false);
		// A cap that cannot be read must not silently become "no cap".
		expect(() => rules.file({ size: "2 bananas" })).toThrow(RuneError);
	});

	it("range takes the upstream tuple", () => {
		const s = schema({ age: rules.number().range([18, 60]) });
		expect(s.validateResult({ age: 30 }).valid).toBe(true);
		expect(s.validateResult({ age: 17 }).valid).toBe(false);
		expect(s.validateResult({ age: 61 }).valid).toBe(false);
	});

	it("parse() receives the upstream context", () => {
		let seen: Record<string, unknown> = {};
		const s = schema({
			currency: rules.string(),
			amount: rules.number().parse((value, ctx) => {
				seen = { parent: ctx.parent, meta: ctx.meta };
				return value;
			}),
		});
		s.validateResult(
			{ currency: "CHF", amount: 10 },
			{ meta: { tenantId: 4 } },
		);
		expect((seen.parent as Record<string, unknown>).currency).toBe("CHF");
		expect((seen.meta as Record<string, unknown>).tenantId).toBe(4);
	});

	it("array notEmpty / compact / composite distinct", () => {
		expect(
			schema({ t: rules.array(rules.string()).notEmpty() }).validateResult({
				t: [],
			}).valid,
		).toBe(false);

		const compacted = schema({ t: rules.array(rules.string()).compact() });
		expect(compacted.validateOrThrow({ t: ["a", null, "", "b"] }).t).toEqual([
			"a",
			"b",
		]);

		const composite = schema({
			rows: rules
				.array(rules.any().object({ a: rules.number(), b: rules.number() }))
				.distinct(["a", "b"]),
		});
		expect(
			composite.validateResult({
				rows: [
					{ a: 1, b: 1 },
					{ a: 1, b: 2 },
				],
			}).valid,
		).toBe(true);
		expect(
			composite.validateResult({
				rows: [
					{ a: 1, b: 1 },
					{ a: 1, b: 1 },
				],
			}).valid,
		).toBe(false);
	});

	it("union.otherwise mirrors union.else", () => {
		const v = schema({
			c: rules.union([
				rules.union.if((x) => typeof x === "number", rules.number().positive()),
				rules.union.otherwise(rules.string().email()),
			]),
		});
		expect(v.validateResult({ c: 5 }).valid).toBe(true);
		expect(v.validateResult({ c: "a@b.io" }).valid).toBe(true);
		expect(v.validateResult({ c: "nope" }).errors[0]?.rule).toBe("email");
	});

	it("errorReporter observes every error without changing the outcome", () => {
		const seen: string[] = [];
		const res = schema({
			a: rules.string(),
			b: rules.number(),
		}).validateResult(
			{ a: 1, b: "x" },
			{ errorReporter: (e) => seen.push(e.rule) },
		);
		expect(seen).toEqual(["string", "number"]);
		expect(res.valid).toBe(false);
	});

	it("createRule({ isAsync }) routes through use() to the awaited register", async () => {
		let ran = false;
		const slow = createRule(
			async (_v, _o, field) => {
				await Promise.resolve();
				ran = true;
				field.report("nope", "asyncViaUse");
			},
			{ isAsync: true },
		);
		const v = schema({ a: rules.string().use(slow()) });
		expect(() => v.validateResult({ a: "x" })).toThrow(/validateAsync|Async/);
		const res = await v.validateResultAsync({ a: "x" });
		expect(ran).toBe(true);
		expect(res.errors[0]?.rule).toBe("asyncViaUse");
	});

	it("unionOfTypes is exposed on the default export", () => {
		expect(typeof rune.unionOfTypes).toBe("function");
		expect(typeof rune.union.otherwise).toBe("function");
	});
});

describe("rune > audit 6", () => {
	it("the one-shot helpers relay every ValidateOptions key", () => {
		const seen: string[] = [];
		rune.tryValidate({
			schema: { a: rune.string() },
			data: { a: 1 },
			errorReporter: (e) => seen.push(e.rule),
		});
		// The hand-listed forwarding dropped errorReporter when it was added.
		expect(seen).toEqual(["string"]);
	});

	it("getProperties() hands back clones, not the live chains", () => {
		const base = rules.any().object({ id: rules.number() });
		const props = base.getProperties();
		defined(props?.id).optional();
		// Mutating the copy must not relax the source.
		expect(schema({ u: base }).validateResult({ u: {} }).valid).toBe(false);
	});

	it("partial() can target a subset of keys", () => {
		const base = rules.any().object({ a: rules.string(), b: rules.string() });
		const v = schema({ u: base.partial(["a"]) });
		expect(v.validateResult({ u: { b: "x" } }).valid).toBe(true);
		expect(v.validateResult({ u: { a: "x" } }).valid).toBe(false);
	});

	it("unionOfTypes discriminates by type and refuses ambiguity", () => {
		const v = schema({
			id: rune.unionOfTypes([rules.number().positive(), rules.string().uuid()]),
		});
		expect(v.validateResult({ id: 7 }).valid).toBe(true);
		expect(v.validateResult({ id: -1 }).errors[0]?.rule).toBe("positive");
		// Two branches of the same type: the second could never be reached.
		expect(() =>
			rune.unionOfTypes([rules.string().email(), rules.string().uuid()]),
		).toThrow(RuneError);
		expect(() => rune.unionOfTypes([rules.any()])).toThrow(RuneError);
	});

	it("url and normalizeEmail accept the validator.js snake_case options", () => {
		expect(
			schema({
				u: rules.string().url({ require_protocol: false }),
			}).validateResult({ u: "example.com" }).valid,
		).toBe(true);
		expect(
			schema({
				e: rules.string().normalizeEmail({ gmail_remove_dots: true }),
			}).validateOrThrow({ e: "a.d.a@gmail.com" }).e,
		).toBe("ada@gmail.com");
	});

	it("nativeFile enforces minSize / maxSize / mimeTypes", async () => {
		// Declaring mimeTypes turns the content check on, so the payload carries
		// real bytes and the schema runs async.
		const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
		const s = schema({
			doc: rules.nativeFile({
				minSize: "1kb",
				maxSize: "1mb",
				mimeTypes: ["application/pdf"],
			}),
		});
		expect(
			(
				await s.validateResultAsync({
					doc: { size: 5000, type: "application/pdf", buffer: PDF },
				})
			).valid,
		).toBe(true);
		// Dans la forme à options, min/max/mimeTypes sont vérifiés PAR la règle
		// nativeFile : c'est elle qui rapporte. La forme fluide, elle, nomme la
		// contrainte fautive — voir le test suivant.
		expect(
			(
				await s.validateResultAsync({
					doc: { size: 100, type: "application/pdf", buffer: PDF },
				})
			).errors[0]?.rule,
		).toBe("nativeFile");
		expect(
			(
				await s.validateResultAsync({
					doc: { size: 5000, type: "image/png", buffer: PDF },
				})
			).errors[0]?.rule,
		).toBe("nativeFile");
	});

	it("exposes the Standard Schema contract", async () => {
		const v = schema({ a: rules.string() });
		expect(v["~standard"].version).toBe(1);
		await expect(v["~standard"].validate({ a: "x" })).resolves.toEqual({
			value: { a: "x" },
		});
		const bad = await v["~standard"].validate({ a: 1 });
		expect("issues" in bad && bad.issues[0]?.path).toEqual(["a"]);
	});

	it("exposes the helpers namespace", () => {
		expect(rune.helpers.isTrue("on")).toBe(true);
		expect(rune.helpers.isFalse("0")).toBe(true);
		// "off" and "no" are not on upstream's negative list, "yes" is not on
		// its positive one, and neither list is case-folded.
		expect(rune.helpers.isFalse("off")).toBe(false);
		expect(rune.helpers.isTrue("yes")).toBe(false);
		expect(rune.helpers.exists("")).toBe(true);
		expect(rune.helpers.isMissing(null)).toBe(true);
	});
});

describe("rune > audit 7 — in-house parity, zero dependency", () => {
	it("email() implements the RFC shapes, not a single regex", () => {
		const plain = schema({ e: rules.string().email() });
		for (const ok of [
			"ada@example.com",
			"a.b+tag@sub.example.co.uk",
			"a!#$%&'*+/=?^_`{|}~-@example.com",
		]) {
			expect(plain.validateResult({ e: ok }).valid, ok).toBe(true);
		}
		for (const bad of [
			"ada@example",
			"ada@@example.com",
			"@example.com",
			"ada@-example.com",
			"ada@example-.com",
			"ada@exam ple.com",
			"ada@example.c",
			"Ada <ada@example.com>",
			`${"a".repeat(65)}@example.com`,
		]) {
			expect(plain.validateResult({ e: bad }).valid, bad).toBe(false);
		}
	});

	it("email() honours the validator.js options", () => {
		expect(
			schema({
				e: rules.string().email({ allow_display_name: true }),
			}).validateResult({ e: "Ada <ada@example.com>" }).valid,
		).toBe(true);
		expect(
			schema({
				e: rules.string().email({ require_tld: false }),
			}).validateResult({
				e: "ada@localhost",
			}).valid,
		).toBe(true);
		expect(
			schema({
				e: rules.string().email({ allow_ip_domain: true }),
			}).validateResult({ e: "ada@[192.168.0.1]" }).valid,
		).toBe(true);
		expect(
			schema({
				e: rules.string().email({ blacklisted_chars: "+" }),
			}).validateResult({ e: "a+b@example.com" }).valid,
		).toBe(false);
		// Gmail's own rules: under 6 bare characters is not a Gmail address.
		expect(
			schema({
				e: rules.string().email({ domain_specific_validation: true }),
			}).validateResult({ e: "a.b@gmail.com" }).valid,
		).toBe(false);
	});

	it("a quoted local part and an IP literal are handled structurally", () => {
		const s = schema({ e: rules.string().email({ allow_ip_domain: true }) });
		expect(s.validateResult({ e: '"ada smith"@example.com' }).valid).toBe(true);
		expect(s.validateResult({ e: '"unterminated@example.com' }).valid).toBe(
			false,
		);
		expect(s.validateResult({ e: "ada@[IPv6:::1]" }).valid).toBe(true);
		expect(s.validateResult({ e: "ada@[999.1.1.1]" }).valid).toBe(false);
	});

	it("mobile strictMode requires the country prefix", () => {
		const strict = schema({
			m: rules.string().mobile({ locale: "fr-CH", strictMode: true }),
		});
		expect(strict.validateResult({ m: "+41791234567" }).valid).toBe(true);
		expect(strict.validateResult({ m: "0791234567" }).valid).toBe(false);
		// Without strictMode the national form is accepted.
		expect(
			schema({ m: rules.string().mobile({ locale: "fr-CH" }) }).validateResult({
				m: "0791234567",
			}).valid,
		).toBe(true);
	});

	it("passport accepts several countries", () => {
		const s = schema({
			p: rules.string().passport({ countryCode: ["CH", "US"] }),
		});
		expect(s.validateResult({ p: "X1234567" }).valid).toBe(true);
		expect(s.validateResult({ p: "123456789" }).valid).toBe(true);
		expect(s.validateResult({ p: "nope" }).valid).toBe(false);
	});

	it("the widened tables cover the locales and countries they claim", () => {
		expect(
			schema({
				z: rules.string().postalCode({ countryCode: "PT" }),
			}).validateResult({ z: "1000-100" }).valid,
		).toBe(true);
		expect(
			schema({ m: rules.string().mobile({ locale: "ja-JP" }) }).validateResult({
				m: "+819012345678",
			}).valid,
		).toBe(true);
	});
});

/**
 * The two sets must stay separate. Conflating "translatable message" with "the
 * Rust engine can run it" is what silently un-translated a rule when it left the
 * native path, and silently disabled a TS-only option on a rule that stayed.
 */
describe("rune > message keys and native routing are independent", () => {
	it("email keeps its translated message while running on the TS path", () => {
		setValidationTranslator((key) =>
			key === "validation.email" ? "Email invalide" : key,
		);
		const res = schema({ e: rules.string().email() }).validateResult({
			e: "bad",
		});
		expect(res.errors[0]?.message).toBe("Email invalide");
		setValidationTranslator(undefined);
	});

	it("a TS-only option is never routed to an engine that ignores it", () => {
		// alpha({ allowSpaces }) is implemented in BOTH engines, so it may route
		// natively; email options are TS-only, so the schema must not.
		const withOptions = schema({
			e: rules.string().email({ require_tld: false }),
		});
		expect(withOptions.validateResult({ e: "ada@localhost" }).valid).toBe(true);
	});
});

describe("rune > audit 7 — object composition, introspection, JSON Schema", () => {
	it("validator.schema keeps the object chain, so .partial() works on it", () => {
		const userSchema = rules.any().object({
			id: rules.number(),
			name: rules.string(),
		});
		const v = create(userSchema);
		const chain = v.schema;
		// upstream keeps the compiled object schema, not a bare field map.
		expect(chain).toBeInstanceOf(Object);
		if (chain instanceof Object && "partial" in chain) {
			const relaxed = create((chain as ReturnType<typeof rules.any>).partial());
			expect(relaxed.validateResult({}).valid).toBe(true);
		}
		// …and the source stays strict.
		expect(v.validateResult({}).valid).toBe(false);
	});

	it("toCamelCaseKeys() rewrites the KEYS, not the values", () => {
		const v = schema({
			user: rules
				.any()
				.object({ first_name: rules.string(), last_name: rules.string() })
				.toCamelCaseKeys(),
		});
		const out = v.validateOrThrow({
			user: { first_name: "Ada", last_name: "Lovelace" },
		});
		expect(out.user).toEqual({ firstName: "Ada", lastName: "Lovelace" });
	});

	it("merge() adds properties, and a conditional group picks its branch", () => {
		const merged = schema({
			u: rules
				.any()
				.object({ id: rules.number() })
				.merge({ name: rules.string() }),
		});
		expect(merged.validateResult({ u: { id: 1 } }).valid).toBe(false);
		expect(merged.validateResult({ u: { id: 1, name: "Ada" } }).valid).toBe(
			true,
		);

		const grouped = schema({
			p: rules
				.any()
				.object({ kind: rules.string() })
				.merge(
					rune.group([
						rune.group.if((data) => data.kind === "card", {
							cardNumber: rules.string().creditCard(),
						}),
						rune.group.else({ iban: rules.string().iban() }),
					]),
				),
		});
		expect(
			grouped.validateResult({
				p: { kind: "card", cardNumber: "4242424242424242" },
			}).valid,
		).toBe(true);
		// Wrong branch's field is not accepted as a substitute.
		expect(
			grouped.validateResult({
				p: { kind: "card", iban: "GB82WEST12345698765432" },
			}).valid,
		).toBe(false);
		expect(
			grouped.validateResult({
				p: { kind: "bank", iban: "GB82 WEST 1234 5698 7654 32" },
			}).valid,
		).toBe(true);
	});

	it("toJSONSchema emits the constraints it can express and omits the rest", () => {
		const v = schema({
			email: rules.string().email(),
			age: rules.number().range([18, 60]).optional(),
			tag: rules.string().minLength(2).maxLength(8).nullable(),
		});
		const js = v.toJSONSchema();
		expect(js).toMatchObject({
			type: "object",
			properties: {
				email: { type: "string", format: "email" },
				age: { type: "number", minimum: 18, maximum: 60 },
				tag: { type: ["string", "null"], minLength: 2, maxLength: 8 },
			},
			// `tag` is nullable, NOT optional — a nullable field is still required.
			required: ["email", "tag"],
		});
	});
});

describe("rune > nativeFile fluent API (upstream)", () => {
	it("chains minSize / maxSize / mimeTypes", async () => {
		// mimeTypes() turns the content check on, so the payload carries real bytes
		// and the schema runs async. The fluent form names the failing constraint.
		const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
		const s = schema({
			doc: rules
				.nativeFile()
				.minSize("1kb")
				.maxSize("1mb")
				.mimeTypes(["application/pdf"]),
		});
		const run = (doc: Record<string, unknown>) =>
			s.validateResultAsync({ doc });
		expect(
			(await run({ size: 5000, type: "application/pdf", buffer: PDF })).valid,
		).toBe(true);
		expect(
			(await run({ size: 100, type: "application/pdf", buffer: PDF })).errors[0]
				?.rule,
		).toBe("nativeFile.minSize");
		expect(
			(await run({ size: 5_000_000, type: "application/pdf", buffer: PDF }))
				.errors[0]?.rule,
		).toBe("nativeFile.maxSize");
		expect(
			(await run({ size: 5000, type: "image/png", buffer: PDF })).errors[0]
				?.rule,
		).toBe("nativeFile.mimeTypes");
	});
});

describe("rune > audit 8 — les trois derniers manques", () => {
	it("createRule({ toJSONSchema }) atteint bien toJSONSchema()", () => {
		// Le chemin de LECTURE existait, l'écriture non : la métadonnée était
		// inatteignable depuis l'API publique, donc silencieusement ignorée.
		const evenOnly = createRule(
			(value, _o, field) => {
				if (typeof value === "number" && value % 2 !== 0) {
					field.report("Must be even", "even");
				}
			},
			// upstream metadata is a MODIFIER, not a static fragment: it receives the
			// node built from the declarative rules and returns the node to use.
			{ toJSONSchema: (node) => ({ ...node, multipleOf: 2 }) },
		);
		const v = schema({ n: rules.number().use(evenOnly()) });
		expect(v.toJSONSchema()).toMatchObject({
			properties: { n: { type: "number", multipleOf: 2 } },
		});
		expect(v.validateResult({ n: 3 }).errors[0]?.rule).toBe("even");
	});

	it("parse les tokens de noms, l'ordinal et l'offset", () => {
		const long = schema({ d: rules.date({ formats: ["D MMMM YYYY"] }) });
		const parsed = long.validateOrThrow({ d: "25 June 2026" });
		expect(parsed.d.getMonth()).toBe(5);
		expect(parsed.d.getDate()).toBe(25);

		// Casse indifférente, et forme courte.
		expect(
			schema({ d: rules.date({ formats: ["D MMM YYYY"] }) })
				.validateOrThrow({
					d: "25 jun 2026",
				})
				.d.getMonth(),
		).toBe(5);

		// Le nom de jour est consommé mais ne pilote pas la date.
		const withDay = schema({
			d: rules.date({ formats: ["dddd D MMMM YYYY"] }),
		});
		expect(
			withDay.validateOrThrow({ d: "Thursday 25 June 2026" }).d.getDate(),
		).toBe(25);

		// Ordinal.
		expect(
			schema({ d: rules.date({ formats: ["MMMM Do, YYYY"] }) })
				.validateOrThrow({
					d: "June 25th, 2026",
				})
				.d.getDate(),
		).toBe(25);

		// Offset explicite : l'instant est absolu, pas local.
		expect(
			schema({ d: rules.date({ formats: ["YYYY-MM-DD HH:mm Z"] }) })
				.validateOrThrow({ d: "2026-06-25 12:00 +02:00" })
				.d.toISOString(),
		).toBe("2026-06-25T10:00:00.000Z");

		// Un mois inexistant est rejeté, pas deviné.
		expect(long.validateResult({ d: "25 Juin 2026" }).valid).toBe(false);
	});

	it("normalizeUrl couvre les options de normalize-url", () => {
		const norm = (options: NormalizeUrlOptions) =>
			schema({ u: rules.string().normalizeUrl(options) });
		expect(
			norm({ stripHash: true }).validateOrThrow({ u: "https://a.io/p#frag" }).u,
		).toBe("https://a.io/p");
		expect(
			norm({ forceHttps: true }).validateOrThrow({ u: "http://a.io/p" }).u,
		).toBe("https://a.io/p");
		expect(
			norm({ stripProtocol: true }).validateOrThrow({ u: "https://a.io/p" }).u,
		).toBe("a.io/p");
		expect(
			norm({ removeExplicitPort: true }).validateOrThrow({
				u: "https://a.io:443/p",
			}).u,
		).toBe("https://a.io/p");
		expect(
			norm({ stripAuthentication: true }).validateOrThrow({
				u: "https://u:p@a.io/x",
			}).u,
		).toBe("https://a.io/x");
		expect(
			norm({ sortQueryParameters: true }).validateOrThrow({
				u: "https://a.io/?b=2&a=1",
			}).u,
		).toBe("https://a.io/?a=1&b=2");
		expect(
			norm({ removeQueryParameters: [/^utm_/] }).validateOrThrow({
				u: "https://a.io/?utm_source=x&keep=1",
			}).u,
		).toBe("https://a.io/?keep=1");
		expect(
			norm({ removeDirectoryIndex: true }).validateOrThrow({
				u: "https://a.io/dir/index.html",
			}).u,
		).toBe("https://a.io/dir");
	});
});

describe("rune > audit 8 — the exact shapes of the upstream 4.x API", () => {
	it("errorReporter accepts upstream's FACTORY and the observer", () => {
		// upstream: `errorReporter: () => ErrorReporterContract`. A factory is
		// distinguée d'un observer par l'ARITÉ, jamais en l'appelant pour voir.
		const collected: string[] = [];
		const reporter = () => ({
			hasErrors: false,
			createError: () => new Error("invalid"),
			report(message: string, rule: string) {
				collected.push(`${rule}:${message}`);
				return undefined;
			},
		});
		const res = schema({ a: rules.string() }).validateResult(
			{ a: 1 },
			{ errorReporter: reporter },
		);
		expect(collected).toHaveLength(1);
		expect(collected[0]?.startsWith("string:")).toBe(true);
		// L'observer reste accepté.
		const seen: string[] = [];
		schema({ a: rules.string() }).validateResult(
			{ a: 1 },
			{ errorReporter: (e) => seen.push(e.rule) },
		);
		expect(seen).toEqual(["string"]);
		// Dans les deux cas le reporter n'a pas masqué l'échec.
		expect(res.valid).toBe(false);
	});

	it("validator.schema est toujours une chaîne, donc .partial() marche", () => {
		// Chemin Adonis le plus courant : create() sur une map de champs.
		const v = create({ id: rules.number(), name: rules.string() });
		const relaxed = create(v.schema.partial());
		expect(relaxed.validateResult({}).valid).toBe(true);
		// La source reste stricte.
		expect(v.validateResult({}).valid).toBe(false);
	});

	it("toCamelCase() dispatches on the shape, as upstream does", () => {
		// Sur un objet : les CLÉS.
		const keys = schema({
			u: rules.any().object({ first_name: rules.string() }).toCamelCase(),
		});
		expect(keys.validateOrThrow({ u: { first_name: "Ada" } }).u).toEqual({
			firstName: "Ada",
		});
		// Sur une string : la VALEUR.
		expect(
			schema({ s: rules.string().toCamelCase() }).validateOrThrow({
				s: "hello-world",
			}).s,
		).toBe("helloWorld");
	});

	it("helpers.optional() rend un record de propriétés à spreader", () => {
		// upstream garde ce transformateur sous `helpers`; `optional()` au niveau
		// root is a schema TYPE upstream, not a transformer.
		const shape = { id: rules.number(), name: rules.string() };
		const v = schema({
			u: rules.any().object({ ...rune.helpers.optional(shape) }),
		});
		expect(v.validateResult({ u: {} }).valid).toBe(true);
		// La source n'est pas relâchée par l'opération.
		expect(
			schema({ u: rules.any().object(shape) }).validateResult({ u: {} }).valid,
		).toBe(false);
	});
});

describe("rune > audit 9 — contrat du reporter, types optional/null, JSON Schema", () => {
	it("le reporter DÉCIDE l'erreur levée et reçoit un FieldContext", () => {
		const seen: Array<{ path: string; name: string; wildcard: string }> = [];
		class MyError extends Error {}
		const factory = () => ({
			hasErrors: false,
			createError: () => new MyError("mon format"),
			report(
				_m: string,
				_r: string,
				field: { getFieldPath(): string; name: string; wildCardPath: string },
			) {
				seen.push({
					path: field.getFieldPath(),
					name: field.name,
					wildcard: field.wildCardPath,
				});
				return undefined;
			},
		});
		const v = schema({
			rows: rules.array(rules.any().object({ email: rules.string() })),
		});
		v.errorReporter = factory;
		// upstream : c'est createError() du reporter qui produit l'erreur finale.
		expect(() => v.validateOrThrow({ rows: [{ email: 1 }] })).toThrow(MyError);
		expect(seen[0]?.path).toBe("rows.0.email");
		expect(seen[0]?.name).toBe("email");
		expect(seen[0]?.wildcard).toBe("rows.*.email");
		v.errorReporter = null;
	});

	it("reporter global, par validateur, puis par appel — dans cet ordre", () => {
		const hits: string[] = [];
		rune.errorReporter = () => ({
			hasErrors: false,
			createError: () => new Error("global"),
			report: () => void hits.push("global"),
		});
		const v = schema({ a: rules.string() });
		v.validateResult({ a: 1 });
		expect(hits).toEqual(["global"]);

		v.errorReporter = () => ({
			hasErrors: false,
			createError: () => new Error("validator"),
			report: () => void hits.push("validator"),
		});
		v.validateResult({ a: 1 });
		expect(hits.at(-1)).toBe("validator");

		v.validateResult(
			{ a: 1 },
			{
				errorReporter: () => ({
					hasErrors: false,
					createError: () => new Error("call"),
					report: () => void hits.push("call"),
				}),
			},
		);
		expect(hits.at(-1)).toBe("call");
		v.errorReporter = null;
		rune.errorReporter = null;
	});

	it("optional() et null() sont des TYPES de schéma", () => {
		// upstream builder.d.ts:135/144 — pas des modificateurs.
		const opt = schema({ a: rune.optional() });
		expect(opt.validateResult({}).valid).toBe(true);
		expect(opt.validateResult({ a: 1 }).valid).toBe(false);

		const nul = schema({ a: rune.null() });
		expect(nul.validateResult({ a: null }).valid).toBe(true);
		expect(nul.validateResult({ a: 0 }).valid).toBe(false);
	});

	it("helpers: hasKeys, isDistinct, getNestedValue", () => {
		expect(rune.helpers.hasKeys({ a: 1, b: 2 }, ["a", "b"])).toBe(true);
		expect(rune.helpers.hasKeys({ a: 1 }, ["a", "b"])).toBe(false);
		expect(rune.helpers.isDistinct([1, 2, 3])).toBe(true);
		expect(rune.helpers.isDistinct([{ id: 1 }, { id: 1 }], "id")).toBe(false);
		// Un item sans la clé est ignoré, pas compté comme doublon.
		expect(rune.helpers.isDistinct([{ id: 1 }, {}, {}], "id")).toBe(true);
		expect(
			rune.helpers.getNestedValue("a.b.c", { data: { a: { b: { c: 42 } } } }),
		).toBe(42);
	});

	it("le JSON Schema décrit les conteneurs et les littéraux", () => {
		const v = schema({
			tags: rules.array(rules.string().minLength(2)).notEmpty(),
			pair: rules.tuple([rules.number(), rules.string()]),
			counts: rules.record(rules.number().nonNegative()),
			kind: rules.literal("card"),
			n: rules.number().withoutDecimals(),
		});
		expect(v.toJSONSchema()).toMatchObject({
			properties: {
				tags: {
					type: "array",
					minItems: 1,
					items: { type: "string", minLength: 2 },
				},
				pair: {
					type: "array",
					prefixItems: [{ type: "number" }, { type: "string" }],
				},
				counts: {
					type: "object",
					additionalProperties: { type: "number", minimum: 0 },
				},
				kind: { type: "string", enum: ["card"] },
				n: { type: "integer" },
			},
		});
	});
});

describe("rune > audit 10 — confirmed(as), ~standard.jsonSchema, vat, meta", () => {
	it("confirmed({ as }) reporte sur le champ de CONFIRMATION", () => {
		const v = schema({
			password: rules.string().confirmed({ as: "passwordConfirm" }),
			passwordConfirm: rules.string(),
		});
		const res = v.validateResult({ password: "a", passwordConfirm: "b" });
		expect(res.valid).toBe(false);
		// upstream reporte là où l'utilisateur doit corriger.
		expect(res.errors[0]?.field).toBe("passwordConfirm");
		expect(res.errors[0]?.rule).toBe("confirmed");
		// L'alias déprécié marche toujours.
		expect(
			schema({
				pwd: rules.string().confirmed({ confirmationField: "pwd2" }),
				pwd2: rules.string(),
			}).validateResult({ pwd: "a", pwd2: "a" }).valid,
		).toBe(true);
	});

	it("~standard.jsonSchema.input()/output()", () => {
		const v = schema({ a: rules.string().minLength(2) });
		expect(v["~standard"].jsonSchema.input()).toMatchObject({
			properties: { a: { type: "string", minLength: 2 } },
		});
		// output() REFUSES, as upstream's does: a transform can produce anything,
		// so a schema claiming to describe the result would be a guess. rune used
		// to hand back the INPUT schema, which was that guess dressed as an
		// answer.
		expect(() => v["~standard"].jsonSchema.output()).toThrow(RuneError);
	});

	it("vat() valide format ET checksum, et lève sur un pays inconnu", () => {
		const be = schema({ n: rules.string().vat({ countryCode: "BE" }) });
		// Clé mod-97 juste (97 - (8 premiers mod 97) == 2 derniers).
		expect(be.validateResult({ n: "BE0428759497" }).valid).toBe(true);
		// Même format, clé faussée.
		expect(be.validateResult({ n: "BE0428759498" }).valid).toBe(false);

		const ch = schema({ n: rules.string().vat({ countryCode: "CH" }) });
		expect(ch.validateResult({ n: "CHE105805187" }).valid).toBe(true);
		expect(ch.validateResult({ n: "CHE105805188" }).valid).toBe(false);

		// Plusieurs pays acceptés.
		expect(
			schema({
				n: rules.string().vat({ countryCode: ["FR", "BE"] }),
			}).validateResult({ n: "BE0428759497" }).valid,
		).toBe(true);

		expect(() => rules.string().vat({ countryCode: "ZZ" })).toThrow(RuneError);
	});

	it("meta() et objets fermés dans le JSON Schema", () => {
		const v = schema({
			u: rules
				.any()
				.object({ id: rules.number() })
				.meta({ title: "User", description: "Un utilisateur" }),
			open: rules.any().object({ id: rules.number() }).allowUnknownProperties(),
		});
		expect(v.toJSONSchema()).toMatchObject({
			properties: {
				u: {
					title: "User",
					description: "Un utilisateur",
					additionalProperties: false,
				},
				open: { additionalProperties: true },
			},
		});
	});
});

describe("rune > audit 11 — root failures and file content", () => {
	/** A real PNG header: the bytes the content check is meant to recognise. */
	const PNG = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
	]);
	/** A reporter that decides its own failure shape, as upstream lets it. */
	const reporterFactory = () => ({
		hasErrors: true,
		createError: () => new Error("from the reporter"),
		report: () => undefined,
	});

	it("the reporter decides the shape of a ROOT failure too", () => {
		// The non-object guard returned the verdict directly, before the reporter
		// was ever built: `validateOrThrow(null)` threw rune's own error while a
		// reporter was bound, so a caller relying on the reporter's exception saw
		// the wrong type exactly on the malformed-payload path.
		const v = create({ a: rules.string() });
		v.errorReporter = reporterFactory;
		expect(() => v.validateOrThrow(null)).toThrowError("from the reporter");
		v.errorReporter = null;
	});

	it("a root failure REPORTS, it does not just fail", () => {
		const seen: string[] = [];
		const res = create({ a: rules.string() }).validateResult("not an object", {
			errorReporter: (e) => seen.push(`${e.field}:${e.rule}`),
		});
		expect(res.valid).toBe(false);
		expect(seen).toEqual(["_root:type"]);
	});

	it("the same holds on the async path", async () => {
		const v = create({ a: rules.string() });
		v.errorReporter = reporterFactory;
		await expect(v.validate(42)).rejects.toThrowError("from the reporter");
		v.errorReporter = null;
	});

	it("a root failure does not throw the PREVIOUS run's reporter error", () => {
		// `reporterError` survives between calls; the early return never reset it,
		// so a root failure resurrected the error of whatever ran before it.
		const v = create({ a: rules.string() });
		v.errorReporter = reporterFactory;
		v.validateResult({ a: 1 });
		v.errorReporter = null;
		expect(() => v.validateOrThrow(null)).not.toThrowError("from the reporter");
	});

	it("nativeFile({ mimeTypes }) confronts the list with the BYTES", async () => {
		// The options form armed the content check but never recorded the list,
		// so the check ran with nothing to compare against: a PNG announcing
		// `application/pdf` passed a schema that only allows PDFs.
		const v = schema({
			f: rules.any().nativeFile({ mimeTypes: ["application/pdf"] }),
		});
		const res = await v.validateResultAsync({
			f: { size: 12, type: "application/pdf", buffer: PNG },
		});
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.rule).toBe("verifyContent");
		// A file that IS what it claims still passes.
		expect(
			(
				await schema({
					f: rules.any().nativeFile({ mimeTypes: ["image/png"] }),
				}).validateResultAsync({
					f: { size: 12, type: "image/png", buffer: PNG },
				})
			).valid,
		).toBe(true);
	});

	it("a MIME list declared AFTER the check is still confronted", async () => {
		// `.verifyContent()` registers the check; `.mimeTypes()` then declares the
		// list. Reading the declarations at registration time froze them at null.
		const v = schema({
			f: rules.any().file().verifyContent().mimeTypes(["application/pdf"]),
		});
		const res = await v.validateResultAsync({
			f: { size: 12, type: "application/pdf", buffer: PNG },
		});
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.rule).toBe("verifyContent");
	});

	it("a MIME list declared after a RE-TYPING call is confronted", async () => {
		// `file()` re-types the chain, so `.mimeTypes()` lands on a copy while the
		// check stayed behind on the original — the copy's list went unread.
		const v = schema({
			f: rules
				.any()
				.file({ extnames: ["png"] })
				.mimeTypes(["application/pdf"]),
		});
		const res = await v.validateResultAsync({
			f: { size: 12, type: "application/pdf", extname: "png", buffer: PNG },
		});
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.rule).toBe("verifyContent");
	});
});

describe("rune > audit 12 — tryValidate and the reporter agree", () => {
	const reporter = () => ({
		hasErrors: true,
		createError: () =>
			new RuneValidationError([
				{ field: "a", rule: "custom", message: "from the reporter" },
			]),
		report: () => undefined,
	});

	it("tryValidate hands back the error the reporter built", () => {
		// `validateOrThrow` honoured the bound reporter and `tryValidate` did
		// not, so the two entry points disagreed about the same run: a caller who
		// moved from one to the other silently lost the reporter's error shape.
		const v = create({ a: rules.string() });
		v.errorReporter = reporter;
		const [error, data] = v.tryValidateSync({ a: 1 });
		expect(data).toBeNull();
		expect(error?.messages[0]?.message).toBe("from the reporter");
		v.errorReporter = null;
	});

	it("the async tuple carries it too", async () => {
		const v = create({ a: rules.string() });
		v.errorReporter = reporter;
		const [error] = await v.tryValidate({ a: 1 });
		expect(error?.messages[0]?.message).toBe("from the reporter");
		v.errorReporter = null;
	});

	it("without a reporter the tuple still carries rune's own error", () => {
		const [error] = create({ a: rules.string() }).tryValidateSync({ a: 1 });
		expect(error).toBeInstanceOf(RuneValidationError);
		expect(error?.messages[0]?.rule).toBe("string");
	});

	it("a reporter error that is not a validation failure is THROWN", () => {
		// The tuple's first slot is a validation failure. Widening it to carry an
		// arbitrary Error is what would make `tryValidate` worthless — so an error
		// that is not one propagates instead of being disguised as one.
		const v = create({ a: rules.string() });
		v.errorReporter = () => ({
			hasErrors: true,
			createError: () => new Error("boom"),
			report: () => undefined,
		});
		expect(() => v.tryValidateSync({ a: 1 })).toThrowError("boom");
		v.errorReporter = null;
	});

	it("a valid payload is untouched by the reporter", () => {
		const v = create({ a: rules.string() });
		v.errorReporter = reporter;
		expect(v.tryValidateSync({ a: "ok" })).toEqual([null, { a: "ok" }]);
		v.errorReporter = null;
	});
});

describe("rune > audit 13 — async rules and the messages provider", () => {
	it("an `async` validator is awaited without being declared async", async () => {
		// rune only looked at `{ isAsync: true }`, so an async validator was run
		// as a sync one: its Promise was dropped, the run answered `valid: true`,
		// and the rule reported its refusal afterwards into nothing.
		const ran: string[] = [];
		const slowRefuse = createRule(async (_v, _o, field) => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			ran.push("ran");
			field.report("always refused", "slow", field);
		});
		const v = schema({ a: rules.string().use(slowRefuse()) });
		const result = await v.validateResultAsync({ a: "x" });
		expect(result.valid).toBe(false);
		expect(result.errors[0]?.rule).toBe("slow");
		expect(ran).toEqual(["ran"]);
	});

	it("and the schema refuses to run that rule synchronously", () => {
		const slowRefuse = createRule(async (_v, _o, field) => {
			field.report("always refused", "slow", field);
		});
		const v = schema({ a: rules.string().use(slowRefuse()) });
		expect(() => v.validateResult({ a: "x" })).toThrow(/async/i);
	});

	it("a validator that merely RETURNS a promise is refused, not ignored", () => {
		// Not declared `async`, so nothing can detect it before it runs — and its
		// verdict would land after validation ended.
		// A `void`-returning callback is allowed to return a value in TypeScript,
		// which is exactly how the hole is reachable without a cast.
		const returnsThenable: RuleValidator = () => Promise.resolve();
		const sneaky = createRule(returnsThenable);
		const v = schema({ a: rules.string().use(sneaky()) });
		expect(() => v.validateResult({ a: "x" })).toThrow(RuneError);
	});

	it("{ isAsync: true } still works, and stays the spelling", () => {
		const explicit = createRule(
			async (_v, _o, field) => {
				field.report("refused", "explicit", field);
			},
			{ isAsync: true },
		);
		const v = schema({ a: rules.string().use(explicit()) });
		expect(() => v.validateResult({ a: "x" })).toThrow(/async/i);
	});

	it("the messages provider receives a FIELD CONTEXT, not a path string", () => {
		// A provider transcribed from the upstream convention reads getFieldPath(),
		// name and wildCardPath off the field. rune handed it a string, so all
		// three came back undefined.
		const seen: Array<Record<string, unknown>> = [];
		const provider = {
			getMessage(
				raw: string,
				rule: string,
				field: {
					name: string | number;
					wildCardPath: string;
					getFieldPath(): string;
				},
			): string {
				seen.push({
					rule,
					path: field.getFieldPath(),
					name: field.name,
					wildCardPath: field.wildCardPath,
				});
				return raw;
			},
		};
		schema({
			tags: rules.array(rules.string().minLength(3)),
		}).validateResult({ tags: ["ab"] }, { messagesProvider: provider });
		expect(seen[0]?.path).toBe("tags.0");
		expect(seen[0]?.wildCardPath).toBe("tags.*");
		// And an array item's name is its index, as a number.
		expect(seen[0]?.name).toBe(0);
	});

	it("a label keyed by the bare NAME covers every path ending in it", () => {
		// The lookup is three steps: full path, then bare name, then the name
		// itself. rune only tried the full path, so `{ link: 'some link' }` left
		// the message saying `auth.profile.link`.
		const provider = new SimpleMessagesProvider(
			{ required: "{{ field }} missing" },
			{ link: "some link" },
		);
		const result = schema({
			auth: rules.any().object({
				profile: rules.any().object({ link: rules.string() }),
			}),
		}).validateResult(
			{ auth: { profile: {} } },
			{ messagesProvider: provider },
		);
		expect(result.errors[0]?.message).toBe("some link missing");
	});

	it("the full path still wins over the bare name", () => {
		const provider = new SimpleMessagesProvider(
			{ required: "{{ field }} missing" },
			{ link: "some link", "auth.profile.link": "the profile link" },
		);
		const result = schema({
			auth: rules.any().object({
				profile: rules.any().object({ link: rules.string() }),
			}),
		}).validateResult(
			{ auth: { profile: {} } },
			{ messagesProvider: provider },
		);
		expect(result.errors[0]?.message).toBe("the profile link missing");
	});

	it("a wildcard message key matches an array item", () => {
		const provider = new SimpleMessagesProvider({
			"tags.*.minLength": "{{ field }} is too short",
		});
		const result = schema({
			tags: rules.array(rules.string().minLength(3)),
		}).validateResult({ tags: ["ab"] }, { messagesProvider: provider });
		expect(result.errors[0]?.message).toBe("0 is too short");
	});
});

describe("rune > audit 14", () => {
	it("{ async: true } — the spelling upstream documents — awaits the rule", async () => {
		// upstream's docs show `createRule(fn, { async: true })`; its code reads
		// only `isAsync`, so upstream builds this rule SYNCHRONOUS and drops the
		// Promise: the payload validates while the rule is still refusing it.
		// Verified against the upstream package 4.4.0, which returns the value unchanged.
		const rejects = createRule(
			(_value: unknown, _options: undefined, field) =>
				new Promise<void>((resolve) => {
					setTimeout(() => {
						field.report("already taken", "unique", field);
						resolve();
					}, 1);
				}),
			{ async: true },
		);
		const result = await schema({
			email: rules.string().useAsync(rejects()),
		}).validateResultAsync({ email: "taken@example.com" });
		expect(result.valid).toBe(false);
		expect(result.errors[0]?.rule).toBe("unique");
	});

	it("{ async: true } and { isAsync: true } build the same kind of rule", () => {
		// Deliberately NOT declared `async`: an AsyncFunction would be detected
		// on its own, so the test would pass without either option being read.
		const body = (): Promise<void> => Promise.resolve();
		expect(createRule(body, { async: true })().__rune).toBe("asyncRule");
		expect(createRule(body, { isAsync: true })().__rune).toBe("asyncRule");
	});

	it("a per-validator messagesProvider is honoured", () => {
		const validator = schema({ name: rules.string() });
		validator.messagesProvider = new SimpleMessagesProvider({
			required: "{{ field }} is mandatory",
		});
		const result = validator.validateResult({});
		expect(result.errors[0]?.message).toBe("name is mandatory");
	});

	it("the async path honours the validator's provider too", async () => {
		// validateResultAsync builds its own run context; the first fix touched
		// only the sync gate, so this path needed its own wiring.
		const validator = schema({ name: rules.string() });
		validator.messagesProvider = new SimpleMessagesProvider({
			required: "{{ field }} is mandatory",
		});
		const result = await validator.validateResultAsync({});
		expect(result.errors[0]?.message).toBe("name is mandatory");
	});

	it("a per-call messagesProvider still wins over the validator's", () => {
		const validator = schema({ name: rules.string() });
		validator.messagesProvider = new SimpleMessagesProvider({
			required: "from the validator",
		});
		const result = validator.validateResult(
			{},
			{
				messagesProvider: new SimpleMessagesProvider({
					required: "from the call",
				}),
			},
		);
		expect(result.errors[0]?.message).toBe("from the call");
	});

	it("the validator's provider is readable back and clearable", () => {
		const validator = schema({ name: rules.string() });
		expect(validator.messagesProvider).toBe(null);
		const provider = new SimpleMessagesProvider({ required: "nope" });
		validator.messagesProvider = provider;
		expect(validator.messagesProvider).toBe(provider);
		validator.messagesProvider = null;
		expect(validator.validateResult({}).errors[0]?.message).not.toBe("nope");
	});

	it("jsonSchema.input() accepts the target it actually emits", () => {
		const validator = schema({ name: rules.string() });
		const standard = validator["~standard"];
		expect(standard.jsonSchema.input({ target: "draft-2020-12" })).toEqual(
			standard.jsonSchema.input(),
		);
	});

	it("jsonSchema.input() refuses a dialect rune does not emit", () => {
		const standard = schema({ name: rules.string() })["~standard"];
		// The Standard JSON Schema spec says to throw rather than hand back a
		// shape the caller will read under different rules — `openapi-3.0` spells
		// nullability `nullable: true`, not a `type` array.
		for (const target of ["openapi-3.0", "draft-07", "unknown"]) {
			expect(() => standard.jsonSchema.input({ target })).toThrowError(
				RuneError,
			);
		}
		let code: string | undefined;
		try {
			standard.jsonSchema.input({ target: "openapi-3.0" });
		} catch (error) {
			if (error instanceof RuneError) code = error.code;
		}
		expect(code).toBe("E_RUNE_UNSUPPORTED_JSON_SCHEMA_TARGET");
	});
});

describe("rune > audit 15", () => {
	it("enum() accepts a native TypeScript enum", () => {
		// A TS enum compiles to a plain object, not an array. Iterating it as an
		// array threw a TypeError, so `rules.enum(MyEnum)` was unusable.
		enum Role {
			Admin = "admin",
			User = "user",
		}
		const s = schema({ role: rules.enum(Role) });
		expect(s.validateResult({ role: "admin" }).valid).toBe(true);
		expect(s.validateResult({ role: "Admin" }).valid).toBe(false);
		expect(s.validateResult({ role: "ghost" }).valid).toBe(false);
	});

	it("a numeric enum keeps TypeScript's reverse mapping, as upstream does", () => {
		enum Level {
			Low = 0,
			High = 1,
		}
		const s = schema({ level: rules.enum(Level) });
		expect(s.validateResult({ level: 0 }).valid).toBe(true);
		// `Object.values` on a numeric enum yields the member NAMES too. That is
		// upstream's behaviour, matched deliberately.
		expect(s.validateResult({ level: "Low" }).valid).toBe(true);
		expect(s.validateResult({ level: 2 }).valid).toBe(false);
	});

	it("a plain array of choices still works", () => {
		const s = schema({ c: rules.enum(["a", "b"] as const) });
		expect(s.validateResult({ c: "a" }).valid).toBe(true);
		expect(s.validateResult({ c: "z" }).valid).toBe(false);
	});

	it("accepted() takes upstream's exact list, case included", () => {
		const s = schema({ terms: rules.accepted() });
		for (const ok of ["on", "1", "yes", "true", true, 1]) {
			expect(s.validateResult({ terms: ok }).valid, String(ok)).toBe(true);
			// rune normalises to `true`; upstream declares that output type and
			// then hands back the raw value, which its own type says it will not.
			expect(s.validateResult({ terms: ok }).data?.terms).toBe(true);
		}
		// Lowercasing first silently widened a consent checkbox.
		for (const refused of ["YES", "On", "TRUE", "off", ""]) {
			expect(s.validateResult({ terms: refused }).valid, refused).toBe(false);
		}
	});

	it("withMetaData() exposes compile() beside create()", () => {
		const factory = rune.withMetaData<{ tenantId: number }>();
		expect(typeof factory.compile).toBe("function");
		const validator = factory.compile({ name: rules.string() });
		expect(
			validator.validateResult({ name: "Ada" }, { meta: { tenantId: 1 } })
				.valid,
		).toBe(true);
	});

	it("a withMetaData validator keeps its accessors live", () => {
		// The wrapper used to spread the validator, which flattens `errorReporter`
		// and `messagesProvider` into dead plain properties — assigning to them
		// silently did nothing.
		const validator = rune
			.withMetaData<{ tenantId: number }>((meta) => {
				if (typeof meta.tenantId !== "number") throw new Error("bad meta");
			})
			.compile({ name: rules.string() });
		const before = validator.validateResult({}, { meta: { tenantId: 1 } });
		expect(before.errors[0]?.message).not.toBe("PROVIDER REACHED");
		validator.messagesProvider = new SimpleMessagesProvider({
			required: "PROVIDER REACHED",
		});
		expect(validator.messagesProvider).not.toBe(null);
		const result = validator.validateResult({}, { meta: { tenantId: 1 } });
		expect(result.errors[0]?.message).toBe("PROVIDER REACHED");
	});

	it("a validator keeps the provider that existed when it was built", () => {
		// Upstream captures at compile(), so a later global swap cannot reach
		// back into a validator that already exists.
		rune.messagesProvider = new SimpleMessagesProvider({ required: "BEFORE" });
		const validator = schema({ a: rules.string() });
		expect(validator.validateResult({}).errors[0]?.message).toBe("BEFORE");
		rune.messagesProvider = new SimpleMessagesProvider({ required: "AFTER" });
		expect(validator.validateResult({}).errors[0]?.message).toBe("BEFORE");
		rune.messagesProvider = null;
	});

	it("a validator built before any provider still picks up a later one", () => {
		// NAMED DEVIATION from upstream's strict capture: schemas are
		// module-level constants evaluated at import, while the i18n provider is
		// installed in a service provider's boot(). Freezing `null` into every
		// one of them would silently drop translated messages.
		rune.messagesProvider = null;
		const validator = schema({ a: rules.string() });
		rune.messagesProvider = new SimpleMessagesProvider({ required: "LATE" });
		expect(validator.validateResult({}).errors[0]?.message).toBe("LATE");
		rune.messagesProvider = null;
	});
});
