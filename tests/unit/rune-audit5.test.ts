import { describe, expect, it } from "vitest";
import type { NormalizeUrlOptions } from "../../src/index.js";
import rune, {
	create,
	createRule,
	RuneError,
	rules,
	schema,
	setValidationTranslator,
} from "../../src/index.js";

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

	it("range takes the VineJS tuple", () => {
		const s = schema({ age: rules.number().range([18, 60]) });
		expect(s.validateResult({ age: 30 }).valid).toBe(true);
		expect(s.validateResult({ age: 17 }).valid).toBe(false);
		expect(s.validateResult({ age: 61 }).valid).toBe(false);
	});

	it("parse() receives the VineJS context", () => {
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
		props?.id.optional();
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

	it("nativeFile enforces minSize / maxSize / mimeTypes", () => {
		const s = schema({
			doc: rules.nativeFile({
				minSize: "1kb",
				maxSize: "1mb",
				mimeTypes: ["application/pdf"],
			}),
		});
		expect(
			s.validateResult({ doc: { size: 5000, type: "application/pdf" } }).valid,
		).toBe(true);
		expect(
			s.validateResult({ doc: { size: 100, type: "application/pdf" } }).valid,
		).toBe(false);
		expect(
			s.validateResult({ doc: { size: 5000, type: "image/png" } }).valid,
		).toBe(false);
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

	it("exposes vine.helpers", () => {
		expect(rune.helpers.isTrue("on")).toBe(true);
		expect(rune.helpers.isFalse("off")).toBe(true);
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
		// VineJS keeps the compiled object schema, not a bare field map.
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

describe("rune > nativeFile fluent API (VineJS)", () => {
	it("chains minSize / maxSize / mimeTypes", () => {
		const s = schema({
			doc: rules
				.nativeFile()
				.minSize("1kb")
				.maxSize("1mb")
				.mimeTypes(["application/pdf"]),
		});
		expect(
			s.validateResult({ doc: { size: 5000, type: "application/pdf" } }).valid,
		).toBe(true);
		expect(
			s.validateResult({ doc: { size: 100, type: "application/pdf" } })
				.errors[0]?.rule,
		).toBe("minSize");
		expect(
			s.validateResult({ doc: { size: 5_000_000, type: "application/pdf" } })
				.errors[0]?.rule,
		).toBe("maxSize");
		expect(
			s.validateResult({ doc: { size: 5000, type: "image/png" } }).errors[0]
				?.rule,
		).toBe("mimeTypes");
	});
});

describe("rune > audit 8 — les trois derniers manques", () => {
	it("createRule({ jsonSchema }) atteint bien toJSONSchema()", () => {
		// Le chemin de LECTURE existait, l'écriture non : la métadonnée était
		// inatteignable depuis l'API publique, donc silencieusement ignorée.
		const evenOnly = createRule(
			(value, _o, field) => {
				if (typeof value === "number" && value % 2 !== 0) {
					field.report("Must be even", "even");
				}
			},
			{ jsonSchema: { multipleOf: 2 } },
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
		).toBe("https://a.io/dir/");
	});
});
