/**
 * Per-locale format tables.
 *
 * upstream delegates postal codes, mobile numbering plans, passport numbers and
 * VAT numbers to `validator.js`. rune has zero runtime dependencies, so the
 * tables are transcribed here from validator.js 13.15.35 rather than pulled in
 * as a dependency — same patterns, same coverage, no install.
 *
 * Portions derived from validator.js, Copyright (c) 2018 Chris O'Hara
 * <cohara87@gmail.com>, MIT licence. See LICENSE-THIRD-PARTY.md.
 *
 * Two named additions, kept because dropping them would lose coverage rune
 * already had: `TR` for postal codes and `NO` for passports, neither of which
 * validator.js carries. And `GR` alongside `EL` for VAT, because Greece is `EL`
 * in the EU VAT register and `GR` in ISO 3166 — rune answers to both.
 */

/** Postal-code patterns, keyed by ISO 3166-1 alpha-2. */
export const POSTAL_CODES: Record<string, RegExp> = {
	AD: /^AD\d{3}$/,
	AT: /^\d{4}$/,
	AU: /^\d{4}$/,
	AZ: /^AZ\d{4}$/,
	BA: /^([7-8]\d{4}$)/,
	BD: /^([1-8][0-9]{3}|9[0-4][0-9]{2})$/,
	BE: /^\d{4}$/,
	BG: /^\d{4}$/,
	BR: /^\d{5}-?\d{3}$/,
	BY: /^2[1-4]\d{4}$/,
	CA: /^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][\s-]?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
	CH: /^\d{4}$/,
	CN: /^(0[1-7]|1[012356]|2[0-7]|3[0-6]|4[0-7]|5[1-7]|6[1-7]|7[1-5]|8[1345]|9[09])\d{4}$/,
	CO: /^(05|08|11|13|15|17|18|19|20|23|25|27|41|44|47|50|52|54|63|66|68|70|73|76|81|85|86|88|91|94|95|97|99)(\d{4})$/,
	CZ: /^\d{3}\s?\d{2}$/,
	DE: /^\d{5}$/,
	DK: /^\d{4}$/,
	DO: /^\d{5}$/,
	DZ: /^\d{5}$/,
	EE: /^\d{5}$/,
	ES: /^(5[0-2]{1}|[0-4]{1}\d{1})\d{3}$/,
	FI: /^\d{5}$/,
	FR: /^(?:(?:0[1-9]|[1-8]\d|9[0-5])\d{3}|97[1-46]\d{2})$/,
	GB: /^(gir\s?0aa|[a-z]{1,2}\d[\da-z]?\s?(\d[a-z]{2})?)$/i,
	GR: /^\d{3}\s?\d{2}$/,
	HR: /^([1-5]\d{4}$)/,
	HT: /^HT\d{4}$/,
	HU: /^\d{4}$/,
	ID: /^\d{5}$/,
	IE: /^(?!.*(?:o))[A-Za-z]\d[\dw]\s\w{4}$/i,
	IL: /^(\d{5}|\d{7})$/,
	IN: /^((?!10|29|35|54|55|65|66|86|87|88|89)[1-9][0-9]{5})$/,
	IR: /^(?!(\d)\1{3})[13-9]{4}[1346-9][013-9]{5}$/,
	IS: /^\d{3}$/,
	IT: /^\d{5}$/,
	JP: /^\d{3}-\d{4}$/,
	KE: /^\d{5}$/,
	KR: /^(\d{5}|\d{6})$/,
	LI: /^(948[5-9]|949[0-7])$/,
	LT: /^LT-\d{5}$/,
	LU: /^\d{4}$/,
	LV: /^LV-\d{4}$/,
	LK: /^\d{5}$/,
	MC: /^980\d{2}$/,
	MG: /^\d{3}$/,
	MX: /^\d{5}$/,
	MT: /^[A-Za-z]{3}\s{0,1}\d{4}$/,
	MY: /^\d{5}$/,
	NL: /^[1-9]\d{3}\s?(?!sa|sd|ss)[a-z]{2}$/i,
	NO: /^\d{4}$/,
	NP: /^(10|21|22|32|33|34|44|45|56|57)\d{3}$|^(977)$/i,
	NZ: /^\d{4}$/,
	PK: /^\d{5}$/,
	PL: /^\d{2}-\d{3}$/,
	PR: /^00[679]\d{2}([ -]\d{4})?$/,
	PT: /^\d{4}-\d{3}?$/,
	RO: /^\d{6}$/,
	RU: /^\d{6}$/,
	SA: /^\d{5}$/,
	SE: /^[1-9]\d{2}\s?\d{2}$/,
	SG: /^\d{6}$/,
	SI: /^\d{4}$/,
	SK: /^\d{3}\s?\d{2}$/,
	TH: /^\d{5}$/,
	TN: /^\d{4}$/,
	TW: /^\d{3}(\d{2,3})?$/,
	UA: /^\d{5}$/,
	US: /^\d{5}(-\d{4})?$/,
	ZA: /^\d{4}$/,
	ZM: /^\d{5}$/,
	TR: /^\d{5}$/,
};

/** Mobile numbering plans, keyed by `language-COUNTRY`. */
export const MOBILE_LOCALES: Record<string, RegExp> = {
	"am-AM": /^(\+?374|0)(33|4[134]|55|77|88|9[13-689])\d{6}$/,
	"ar-AE": /^((\+?971)|0)?5[024568]\d{7}$/,
	"ar-BH": /^(\+?973)?(3|6)\d{7}$/,
	"ar-DZ": /^(\+?213|0)(5|6|7)\d{8}$/,
	"ar-LB": /^(\+?961)?((3|81)\d{6}|7\d{7})$/,
	"ar-EG": /^((\+?20)|0)?1[0125]\d{8}$/,
	"ar-IQ": /^(\+?964|0)?7[0-9]\d{8}$/,
	"ar-JO": /^(\+?962|0)?7[789]\d{7}$/,
	"ar-KW": /^(\+?965)([569]\d{7}|41\d{6})$/,
	"ar-LY": /^((\+?218)|0)?(9[1-6]\d{7}|[1-8]\d{7,9})$/,
	"ar-MA": /^(?:(?:\+|00)212|0)[5-7]\d{8}$/,
	"ar-OM": /^((\+|00)968)?([79][1-9])\d{6}$/,
	"ar-PS": /^(\+?970|0)5[6|9](\d{7})$/,
	"ar-SA": /^(!?(\+?966)|0)?5\d{8}$/,
	"ar-SD": /^((\+?249)|0)?(9[012369]|1[012])\d{7}$/,
	"ar-SY": /^(!?(\+?963)|0)?9\d{8}$/,
	"ar-TN": /^(\+?216)?[2459]\d{7}$/,
	"az-AZ": /^(\+994|0)(10|5[015]|7[07]|99)\d{7}$/,
	"ar-QA": /^(\+?974|0)?([3567]\d{7})$/,
	"bs-BA": /^((((\+|00)3876)|06))((([0-3]|[5-6])\d{6})|(4\d{7}))$/,
	"be-BY": /^(\+?375)?(24|25|29|33|44)\d{7}$/,
	"bg-BG": /^(\+?359|0)?8[789]\d{7}$/,
	"bn-BD": /^(\+?880|0)1[13456789][0-9]{8}$/,
	"ca-AD": /^(\+376)?[346]\d{5}$/,
	"cs-CZ": /^(\+?420)? ?[1-9][0-9]{2} ?[0-9]{3} ?[0-9]{3}$/,
	"da-DK": /^(\+?45)?\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{2}$/,
	"de-DE": /^((\+49|0)1)(5[0-25-9]\d|6([23]|0\d?)|7([0-57-9]|6\d))\d{7,9}$/,
	"de-AT": /^(\+43|0)\d{1,4}\d{3,12}$/,
	"de-CH": /^(\+41|0)([1-9])\d{1,9}$/,
	"de-LU": /^(\+352)?((6\d1)\d{6})$/,
	"dv-MV": /^(\+?960)?(7[2-9]|9[1-9])\d{5}$/,
	"el-GR": /^(\+?30|0)?6(8[5-9]|9(?![26])[0-9])\d{7}$/,
	"el-CY": /^(\+?357?)?(9(9|7|6|5|4)\d{6})$/,
	"en-AI":
		/^(\+?1|0)264(?:2(35|92)|4(?:6[1-2]|76|97)|5(?:3[6-9]|8[1-4])|7(?:2(4|9)|72))\d{4}$/,
	"en-AU": /^(\+?61|0)4\d{8}$/,
	"en-AG": /^(?:\+1|1)268(?:464|7(?:1[3-9]|[28]\d|3[0246]|64|7[0-689]))\d{4}$/,
	"en-BM": /^(\+?1)?441(((3|7)\d{6}$)|(5[0-3][0-9]\d{4}$)|(59\d{5}$))/,
	"en-BS": /^(\+?1[-\s]?|0)?\(?242\)?[-\s]?\d{3}[-\s]?\d{4}$/,
	"en-GB": /^(\+?44|0)7[1-9]\d{8}$/,
	"en-GG": /^(\+?44|0)1481\d{6}$/,
	"en-GH": /^(\+233|0)(20|50|24|54|27|57|26|56|23|53|28|55|59)\d{7}$/,
	"en-GY": /^(\+592|0)6\d{6}$/,
	"en-HK": /^(\+?852[-\s]?)?[456789]\d{3}[-\s]?\d{4}$/,
	"en-MO": /^(\+?853[-\s]?)?[6]\d{3}[-\s]?\d{4}$/,
	"en-IE": /^(\+?353|0)8[356789]\d{7}$/,
	"en-IN": /^(\+?91|0)?[6789]\d{9}$/,
	"en-JM": /^(\+?876)?\d{7}$/,
	"en-KE": /^(\+?254|0)(7|1)\d{8}$/,
	"fr-CF": /^(\+?236| ?)(70|75|77|72|21|22)\d{6}$/,
	"en-SS": /^(\+?211|0)(9[1257])\d{7}$/,
	"en-KI": /^((\+686|686)?)?( )?((6|7)(2|3|8)[0-9]{6})$/,
	"en-KN": /^(?:\+1|1)869(?:46\d|48[89]|55[6-8]|66\d|76[02-7])\d{4}$/,
	"en-LS": /^(\+?266)(22|28|57|58|59|27|52)\d{6}$/,
	"en-MT": /^(\+?356|0)?(99|79|77|21|27|22|25)[0-9]{6}$/,
	"en-MU": /^(\+?230|0)?\d{8}$/,
	"en-MW":
		/^(\+?265|0)(((77|88|31|99|98|21)\d{7})|(((111)|1)\d{6})|(32000\d{4}))$/,
	"en-NA": /^(\+?264|0)(6|8)\d{7}$/,
	"en-NG": /^(\+?234|0)?[789]\d{9}$/,
	"en-NZ": /^(\+?64|0)[28]\d{7,9}$/,
	"en-PG": /^(\+?675|0)?(7\d|8[18])\d{6}$/,
	"en-PK": /^((00|\+)?92|0)3[0-6]\d{8}$/,
	"en-PH": /^(09|\+639)\d{9}$/,
	"en-RW": /^(\+?250|0)?[7]\d{8}$/,
	"en-SG": /^(\+65)?[3689]\d{7}$/,
	"en-SL": /^(\+?232|0)\d{8}$/,
	"en-TZ": /^(\+?255|0)?[67]\d{8}$/,
	"en-UG": /^(\+?256|0)?[7]\d{8}$/,
	"en-US":
		/^((\+1|1)?( |-)?)?(\([2-9][0-9]{2}\)|[2-9][0-9]{2})( |-)?([2-9][0-9]{2}( |-)?[0-9]{4})$/,
	"en-ZA": /^(\+?27|0)\d{9}$/,
	"en-ZM": /^(\+?26)?0[79][567]\d{7}$/,
	"en-ZW": /^(\+263)[0-9]{9}$/,
	"en-BW": /^(\+?267)?(7[1-8]{1})\d{6}$/,
	"es-AR": /^\+?549(11|[2368]\d)\d{8}$/,
	"es-BO": /^(\+?591)?(6|7)\d{7}$/,
	"es-CO": /^(\+?57)?3(0(0|1|2|4|5)|1\d|2[0-4]|5(0|1))\d{7}$/,
	"es-CL": /^(\+?56|0)[2-9]\d{1}\d{7}$/,
	"es-CR": /^(\+506)?[2-8]\d{7}$/,
	"es-CU": /^(\+53|0053)?5\d{7}$/,
	"es-DO": /^(\+?1)?8[024]9\d{7}$/,
	"es-HN": /^(\+?504)?[9|8|3|2]\d{7}$/,
	"es-EC": /^(\+?593|0)([2-7]|9[2-9])\d{7}$/,
	"es-ES": /^(\+?34)?[6|7]\d{8}$/,
	"es-GT": /^(\+?502)?[2|6|7]\d{7}$/,
	"es-PE": /^(\+?51)?9\d{8}$/,
	"es-MX": /^(\+?52)?(1|01)?\d{10,11}$/,
	"es-NI": /^(\+?505)\d{7,8}$/,
	"es-PA": /^(\+?507)\d{7,8}$/,
	"es-PY": /^(\+?595|0)9[9876]\d{7}$/,
	"es-SV": /^(\+?503)?[67]\d{7}$/,
	"es-UY": /^(\+598|0)9[1-9][\d]{6}$/,
	"es-VE": /^(\+?58)?(2|4)\d{9}$/,
	"et-EE": /^(\+?372)?\s?(5|8[1-4])\s?([0-9]\s?){6,7}$/,
	"fa-IR": /^(\+?98[-\s]?|0)9[0-39]\d[-\s]?\d{3}[-\s]?\d{4}$/,
	"fi-FI": /^(\+?358|0)\s?(4[0-6]|50)\s?(\d\s?){4,8}$/,
	"fj-FJ": /^(\+?679)?\s?\d{3}\s?\d{4}$/,
	"fo-FO": /^(\+?298)?\s?\d{2}\s?\d{2}\s?\d{2}$/,
	"fr-BF": /^(\+226|0)[67]\d{7}$/,
	"fr-BJ": /^(\+229)\d{8}$/,
	"fr-CD": /^(\+?243|0)?(8|9)\d{8}$/,
	"fr-CM": /^(\+?237)6[0-9]{8}$/,
	"fr-DJ": /^(?:\+253)?77[6-8]\d{5}$/,
	"fr-FR": /^(\+?33|0)[67]\d{8}$/,
	"fr-GF": /^(\+?594|0|00594)[67]\d{8}$/,
	"fr-GP": /^(\+?590|0|00590)[67]\d{8}$/,
	"fr-MQ": /^(\+?596|0|00596)[67]\d{8}$/,
	"fr-PF": /^(\+?689)?8[789]\d{6}$/,
	"fr-RE": /^(\+?262|0|00262)[67]\d{8}$/,
	"fr-WF": /^(\+681)?\d{6}$/,
	"he-IL": /^(\+972|0)([23489]|5[012345689]|77)[1-9]\d{6}$/,
	"hu-HU": /^(\+?36|06)(20|30|31|50|70)\d{7}$/,
	"id-ID":
		/^(\+?62|0)8(1[123456789]|2[1238]|3[1238]|5[12356789]|7[78]|9[56789]|8[123456789])([\s?|\d]{5,11})$/,
	"ir-IR": /^(\+98|0)?9\d{9}$/,
	"it-IT": /^(\+?39)?\s?3\d{2} ?\d{6,7}$/,
	"it-SM": /^((\+378)|(0549)|(\+390549)|(\+3780549))?6\d{5,9}$/,
	"ja-JP": /^(\+81[ -]?(\(0\))?|0)[6789]0[ -]?\d{4}[ -]?\d{4}$/,
	"ka-GE": /^(\+?995)?(79\d{7}|5\d{8})$/,
	"kk-KZ": /^(\+?7|8)?7\d{9}$/,
	"kl-GL": /^(\+?299)?\s?\d{2}\s?\d{2}\s?\d{2}$/,
	"ko-KR": /^((\+?82)[ -]?)?0?1([0|1|6|7|8|9]{1})[ -]?\d{3,4}[ -]?\d{4}$/,
	"ky-KG":
		/^(\+996\s?)?(22[0-9]|50[0-9]|55[0-9]|70[0-9]|75[0-9]|77[0-9]|880|990|995|996|997|998)\s?\d{3}\s?\d{3}$/,
	"lt-LT": /^(\+370|8)\d{8}$/,
	"lv-LV": /^(\+?371)2\d{7}$/,
	"mg-MG": /^((\+?261|0)(2|3)\d)?\d{7}$/,
	"mn-MN": /^(\+|00|011)?976(77|81|88|91|94|95|96|99)\d{6}$/,
	"my-MM": /^(\+?959|09|9)(2[5-7]|3[1-2]|4[0-5]|6[6-9]|7[5-9]|9[6-9])[0-9]{7}$/,
	"ms-MY": /^(\+?60|0)1(([0145](-|\s)?\d{7,8})|([236-9](-|\s)?\d{7}))$/,
	"mz-MZ": /^(\+?258)?8[234567]\d{7}$/,
	"nb-NO": /^(\+?47)?[49]\d{7}$/,
	"ne-NP": /^(\+?977)?9[78]\d{8}$/,
	"nl-BE": /^(\+?32|0)4\d{8}$/,
	"nl-NL": /^(((\+|00)?31\(0\))|((\+|00)?31)|0)6{1}\d{8}$/,
	"nl-AW": /^(\+)?297(56|59|64|73|74|99)\d{5}$/,
	"nn-NO": /^(\+?47)?[49]\d{7}$/,
	"pl-PL": /^(\+?48)? ?([5-8]\d|45) ?\d{3} ?\d{2} ?\d{2}$/,
	"pt-BR":
		/^((\+?55 ?[1-9]{2} ?)|(\+?55 ?\([1-9]{2}\) ?)|(0[1-9]{2} ?)|(\([1-9]{2}\) ?)|([1-9]{2} ?))((\d{4}-?\d{4})|(9[1-9]{1}\d{3}-?\d{4}))$/,
	"pt-PT": /^(\+?351)?9[1236]\d{7}$/,
	"pt-AO": /^(\+?244)?9\d{8}$/,
	"ro-MD": /^(\+?373|0)((6(0|1|2|6|7|8|9))|(7(6|7|8|9)))\d{6}$/,
	"ro-RO": /^(\+?40|0)\s?7\d{2}(\/|\s|\.|-)?\d{3}(\s|\.|-)?\d{3}$/,
	"ru-RU": /^(\+?7|8)?9\d{9}$/,
	"si-LK": /^(?:0|94|\+94)?(7(0|1|2|4|5|6|7|8)( |-)?)\d{7}$/,
	"sl-SI":
		/^(\+386\s?|0)(\d{1}\s?\d{3}\s?\d{2}\s?\d{2}|\d{2}\s?\d{3}\s?\d{3})$/,
	"sk-SK": /^(\+?421)? ?[1-9][0-9]{2} ?[0-9]{3} ?[0-9]{3}$/,
	"so-SO": /^(\+?252|0)((6[0-9])\d{7}|(7[1-9])\d{7})$/,
	"sq-AL": /^(\+355|0)6[2-9]\d{7}$/,
	"sr-RS": /^(\+3816|06)[- \d]{5,9}$/,
	"sv-SE": /^(\+?46|0)[\s-]?7[\s-]?[02369]([\s-]?\d){7}$/,
	"tg-TJ": /^(\+?992)?[5][5]\d{7}$/,
	"th-TH": /^(\+66|66|0)\d{9}$/,
	"tr-TR": /^(\+?90|0)?5\d{9}$/,
	"tk-TM": /^(\+993|993|8)\d{8}$/,
	"uk-UA": /^(\+?38)?0(50|6[36-8]|7[357]|9[1-9])\d{7}$/,
	"uz-UZ": /^(\+?998)?(6[125-79]|7[1-69]|88|9\d)\d{7}$/,
	"vi-VN":
		/^((\+?84)|0)((3([2-9]))|(5([25689]))|(7([0|6-9]))|(8([1-9]))|(9([0-9])))([0-9]{7})$/,
	"zh-CN": /^((\+|00)86)?(1[3-9]|9[28])\d{9}$/,
	"zh-TW": /^(\+?886-?|0)?9\d{8}$/,
	"dz-BT": /^(\+?975|0)?(17|16|77|02)\d{6}$/,
	"ar-YE": /^(((\+|00)9677|0?7)[0137]\d{7}|((\+|00)967|0)[1-7]\d{6})$/,
	"ar-EH": /^(\+?212|0)[\s-]?(5288|5289)[\s-]?\d{5}$/,
	"fa-AF": /^(\+93|0)?(2{1}[0-8]{1}|[3-5]{1}[0-4]{1})(\d{7})$/,
	"mk-MK":
		/^(\+?389|0)?((?:2[2-9]\d{6}|(?:3[1-4]|4[2-8])\d{6}|500\d{5}|5[2-9]\d{6}|7[0-9][2-9]\d{5}|8[1-9]\d{6}|800\d{5}|8009\d{4}))$/,
	"en-CA":
		/^((\+1|1)?( |-)?)?(\([2-9][0-9]{2}\)|[2-9][0-9]{2})( |-)?([2-9][0-9]{2}( |-)?[0-9]{4})$/,
	"fr-CA":
		/^((\+1|1)?( |-)?)?(\([2-9][0-9]{2}\)|[2-9][0-9]{2})( |-)?([2-9][0-9]{2}( |-)?[0-9]{4})$/,
	"fr-BE": /^(\+?32|0)4\d{8}$/,
	"zh-HK": /^(\+?852[-\s]?)?[456789]\d{3}[-\s]?\d{4}$/,
	"zh-MO": /^(\+?853[-\s]?)?[6]\d{3}[-\s]?\d{4}$/,
	"ga-IE": /^(\+?353|0)8[356789]\d{7}$/,
	"fr-CH": /^(\+41|0)([1-9])\d{1,9}$/,
	"it-CH": /^(\+41|0)([1-9])\d{1,9}$/,
};

/** Passport-number patterns, keyed by ISO 3166-1 alpha-2. */
export const PASSPORTS: Record<string, RegExp> = {
	AM: /^[A-Z]{2}\d{7}$/,
	AR: /^[A-Z]{3}\d{6}$/,
	AT: /^[A-Z]\d{7}$/,
	AU: /^[A-Z]\d{7}$/,
	AZ: /^[A-Z]{1}\d{8}$/,
	BE: /^[A-Z]{2}\d{6}$/,
	BG: /^\d{9}$/,
	BR: /^[A-Z]{2}\d{6}$/,
	BY: /^[A-Z]{2}\d{7}$/,
	CA: /^[A-Z]{2}\d{6}$|^[A-Z]\d{6}[A-Z]{2}$/,
	CH: /^[A-Z]\d{7}$/,
	CN: /^G\d{8}$|^E(?![IO])[A-Z0-9]\d{7}$/,
	CY: /^[A-Z](\d{6}|\d{8})$/,
	CZ: /^\d{8}$/,
	DE: /^[CFGHJKLMNPRTVWXYZ0-9]{9}$/,
	DK: /^\d{9}$/,
	DZ: /^\d{9}$/,
	EE: /^([A-Z]\d{7}|[A-Z]{2}\d{7})$/,
	ES: /^[A-Z0-9]{2}([A-Z0-9]?)\d{6}$/,
	FI: /^[A-Z]{2}\d{7}$/,
	FR: /^\d{2}[A-Z]{2}\d{5}$/,
	GB: /^\d{9}$/,
	GR: /^[A-Z]{2}\d{7}$/,
	HR: /^\d{9}$/,
	HU: /^[A-Z]{2}(\d{6}|\d{7})$/,
	IE: /^[A-Z0-9]{2}\d{7}$/,
	IN: /^[A-Z]{1}-?\d{7}$/,
	ID: /^[A-C]\d{7}$/,
	IR: /^[A-Z]\d{8}$/,
	IS: /^(A)\d{7}$/,
	IT: /^[A-Z0-9]{2}\d{7}$/,
	JM: /^[Aa]\d{7}$/,
	JP: /^[A-Z]{2}\d{7}$/,
	KR: /^[MS]\d{8}$/,
	KZ: /^[a-zA-Z]\d{7}$/,
	LI: /^[a-zA-Z]\d{5}$/,
	LT: /^[A-Z0-9]{8}$/,
	LU: /^[A-Z0-9]{8}$/,
	LV: /^[A-Z0-9]{2}\d{7}$/,
	LY: /^[A-Z0-9]{8}$/,
	MT: /^\d{7}$/,
	MZ: /^([A-Z]{2}\d{7})|(\d{2}[A-Z]{2}\d{5})$/,
	MY: /^[AHK]\d{8}$/,
	MX: /^[A-Z]\d{8}$/,
	NL: /^[A-Z]{2}[A-Z0-9]{6}\d$/,
	NZ: /^([Ll]([Aa]|[Dd]|[Ff]|[Hh])|[Ee]([Aa]|[Pp])|[Nn])\d{6}$/,
	PH: /^([A-Z](\d{6}|\d{7}[A-Z]))|([A-Z]{2}(\d{6}|\d{7}))$/,
	PK: /^[A-Z]{2}\d{7}$/,
	PL: /^[A-Z]{2}\d{7}$/,
	PT: /^[A-Z]\d{6}$/,
	RO: /^\d{8,9}$/,
	RU: /^\d{9}$/,
	SE: /^\d{8}$/,
	SL: /^(P)[A-Z]\d{7}$/,
	SK: /^[0-9A-Z]\d{7}$/,
	TH: /^[A-Z]{1,2}\d{6,7}$/,
	TR: /^[A-Z]\d{8}$/,
	UA: /^[A-Z]{2}\d{6}$/,
	US: /^\d{9}$|^[A-Z]\d{8}$/,
	ZA: /^[TAMD]\d{8}$/,
	NO: /^[A-Z]{2}\d{7}$/,
};

/**
 * VAT rules: validator.js's pattern, plus a checksum where rune has one.
 *
 * Named deviation, kept deliberately: validator.js validates most VAT numbers
 * on FORMAT alone. rune additionally runs the country's own check digits when
 * they are short and well defined, so a well-shaped but impossible number is
 * refused. A number rune accepts is therefore always one validator.js accepts;
 * the reverse does not hold, and that is the point.
 */

/** Plain mod-97 over a digit string. */
function mod97(digits: string): number {
	let remainder = 0;
	for (const digit of digits) {
		remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
	}
	return 97 - remainder;
}

/** Portuguese NIF: weighted 9..2 mod 11, a checksum above 9 meaning zero. */
function portugueseChecksum(digits: string): boolean {
	let sum = 0;
	for (let i = 0; i < 8; i++) {
		sum += (digits.charCodeAt(i) - 48) * (9 - i);
	}
	const checksum = 11 - (sum % 11);
	const expected = checksum > 9 ? 0 : checksum;
	return expected === digits.charCodeAt(8) - 48;
}

/** German USt-IdNr. checksum (the "11-test" defined by the Bundeszentralamt). */
function germanChecksum(digits: string): boolean {
	let product = 10;
	for (let i = 0; i < 8; i++) {
		const digit = digits.charCodeAt(i) - 48;
		let sum = (digit + product) % 10;
		if (sum === 0) sum = 10;
		product = (2 * sum) % 11;
	}
	const check = 11 - product;
	return (check === 10 ? 0 : check) === digits.charCodeAt(8) - 48;
}

/** Dutch BTW checksum: weighted 9..2 mod 11 over the first 8 digits. */
function dutchChecksum(digits: string): boolean {
	let sum = 0;
	for (let i = 0; i < 8; i++) {
		sum += (digits.charCodeAt(i) - 48) * (9 - i);
	}
	return sum % 11 === digits.charCodeAt(8) - 48;
}

/** Italian partita IVA: Luhn over 11 digits. */
function luhnLike(digits: string): boolean {
	let sum = 0;
	for (let i = 0; i < 11; i++) {
		let digit = digits.charCodeAt(i) - 48;
		if (i % 2 === 1) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
	}
	return sum % 10 === 0;
}

/**
 * Swiss UID (CHE): weights 5,4,3,2,7,6,5,4 over the first eight digits.
 *
 * The wrap is `(11 - sum % 11) % 11`, not a bare `11 - sum % 11`: a remainder of
 * 10 wraps to a check digit of 1, and rune used to refuse that case outright —
 * rejecting valid UIDs.
 */
function swissUidChecksum(digits: string): boolean {
	const weights = [5, 4, 3, 2, 7, 6, 5, 4];
	let sum = 0;
	for (const [i, weight] of weights.entries()) {
		sum += (digits.charCodeAt(i) - 48) * weight;
	}
	return (11 - (sum % 11)) % 11 === digits.charCodeAt(8) - 48;
}

/** Australian ABN: weighted mod 89 with one subtracted from the first digit. */
function australianAbnChecksum(digits: string): boolean {
	const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
	const abn = String(digits.charCodeAt(0) - 48 - 1) + digits.slice(1);
	let total = 0;
	for (let i = 0; i < 11; i++) {
		total += (weights[i] ?? 0) * (abn.charCodeAt(i) - 48);
	}
	return total !== 0 && total % 89 === 0;
}

/** VAT patterns and, where rune has one, the country's checksum. */
export const VAT_RULES: Record<
	string,
	{ pattern: RegExp; legacy?: RegExp; check?: (digits: string) => boolean }
> = {
	AT: { pattern: /^(AT)?U\d{8}$/, legacy: /^ATU\d{8}$/i },
	BE: {
		pattern: /^(BE)?\d{10}$/,
		check: (d) => mod97(d.slice(0, 8)) === Number(d.slice(8, 10)),
		legacy: /^BE0?\d{9}$/i,
	},
	BG: { pattern: /^(BG)?\d{9,10}$/, legacy: /^BG\d{9,10}$/i },
	HR: { pattern: /^(HR)?\d{11}$/, legacy: /^HR\d{11}$/i },
	CY: { pattern: /^(CY)?\w{9}$/, legacy: /^CY\d{8}[A-Z]$/i },
	CZ: { pattern: /^(CZ)?\d{8,10}$/, legacy: /^CZ\d{8,10}$/i },
	DK: { pattern: /^(DK)?\d{8}$/, legacy: /^DK\d{8}$/i },
	EE: { pattern: /^(EE)?\d{9}$/, legacy: /^EE\d{9}$/i },
	FI: { pattern: /^(FI)?\d{8}$/, legacy: /^FI\d{8}$/i },
	FR: { pattern: /^(FR)([A-Z0-9]{2}\d{9})$/, legacy: /^FR[0-9A-Z]{2}\d{9}$/i },
	DE: { pattern: /^(DE)?\d{9}$/, check: germanChecksum, legacy: /^DE\d{9}$/i },
	EL: { pattern: /^(EL)?\d{9}$/ },
	HU: { pattern: /^(HU)?\d{8}$/, legacy: /^HU\d{8}$/i },
	IE: {
		pattern: /^(IE)?\d{7}\w{1}(W)?$/,
		legacy: /^IE(?:\d{7}[A-W]{1,2}|\d[A-Z+*]\d{5}[A-W])$/i,
	},
	IT: { pattern: /^(IT)?\d{11}$/, check: luhnLike, legacy: /^IT\d{11}$/i },
	LV: { pattern: /^(LV)?\d{11}$/, legacy: /^LV\d{11}$/i },
	LT: { pattern: /^(LT)?\d{9,12}$/, legacy: /^LT(?:\d{9}|\d{12})$/i },
	LU: {
		pattern: /^(LU)?\d{8}$/,
		check: (d) => Number(d.slice(0, 6)) % 89 === Number(d.slice(6, 8)),
		legacy: /^LU\d{8}$/i,
	},
	MT: { pattern: /^(MT)?\d{8}$/, legacy: /^MT\d{8}$/i },
	NL: {
		pattern: /^(NL)?\d{9}B\d{2}$/,
		check: dutchChecksum,
		legacy: /^NL\d{9}B\d{2}$/i,
	},
	PL: {
		pattern:
			/^(PL)?(\d{10}|(\d{3}-\d{3}-\d{2}-\d{2})|(\d{3}-\d{2}-\d{2}-\d{3}))$/,
		legacy: /^PL\d{10}$/i,
	},
	PT: {
		pattern: /^(PT)?\d{9}$/,
		check: portugueseChecksum,
		legacy: /^PT\d{9}$/i,
	},
	RO: { pattern: /^(RO)?\d{2,10}$/, legacy: /^RO\d{2,10}$/i },
	SK: { pattern: /^(SK)?\d{10}$/, legacy: /^SK\d{10}$/i },
	SI: { pattern: /^(SI)?\d{8}$/, legacy: /^SI\d{8}$/i },
	ES: { pattern: /^(ES)?\w\d{7}[A-Z]$/, legacy: /^ES[0-9A-Z]\d{7}[0-9A-Z]$/i },
	SE: { pattern: /^(SE)?\d{12}$/, legacy: /^SE\d{12}$/i },
	AL: { pattern: /^(AL)?\w{9}[A-Z]$/ },
	MK: { pattern: /^(MK)?\d{13}$/ },
	AU: { pattern: /^(AU)?\d{11}$/, check: australianAbnChecksum },
	BY: { pattern: /^(УНП )?\d{9}$/ },
	CA: { pattern: /^(CA)?\d{9}$/ },
	IS: { pattern: /^(IS)?\d{5,6}$/ },
	IN: { pattern: /^(IN)?\d{15}$/ },
	ID: { pattern: /^(ID)?(\d{15}|(\d{2}.\d{3}.\d{3}.\d{1}-\d{3}.\d{3}))$/ },
	IL: { pattern: /^(IL)?\d{9}$/ },
	KZ: { pattern: /^(KZ)?\d{12}$/ },
	NZ: { pattern: /^(NZ)?\d{9}$/ },
	NG: { pattern: /^(NG)?(\d{12}|(\d{8}-\d{4}))$/ },
	NO: { pattern: /^(NO)?\d{9}MVA$/ },
	PH: { pattern: /^(PH)?(\d{12}|\d{3} \d{3} \d{3} \d{3})$/ },
	RU: { pattern: /^(RU)?(\d{10}|\d{12})$/ },
	SM: { pattern: /^(SM)?\d{5}$/ },
	SA: { pattern: /^(SA)?\d{15}$/ },
	RS: { pattern: /^(RS)?\d{9}$/ },
	CH: {
		pattern:
			/^(CHE[- ]?)?(\d{9}|(\d{3}\.\d{3}\.\d{3})|(\d{3} \d{3} \d{3})) ?(TVA|MWST|IVA)?$/,
		check: swissUidChecksum,
		legacy: /^CHE\d{9}(?:TVA|MWST|IVA)?$/i,
	},
	TR: { pattern: /^(TR)?\d{10}$/ },
	UA: { pattern: /^(UA)?\d{12}$/ },
	GB: {
		pattern:
			/^GB((\d{3} \d{4} ([0-8][0-9]|9[0-6]))|(\d{9} \d{3})|(((GD[0-4])|(HA[5-9]))[0-9]{2}))$/,
		legacy: /^GB(?:\d{9}|\d{12}|GD\d{3}|HA\d{3})$/i,
	},
	UZ: { pattern: /^(UZ)?\d{9}$/ },
	AR: { pattern: /^(AR)?\d{11}$/ },
	BO: { pattern: /^(BO)?\d{7}$/ },
	BR: {
		pattern:
			/^(BR)?((\d{2}.\d{3}.\d{3}\/\d{4}-\d{2})|(\d{3}.\d{3}.\d{3}-\d{2}))$/,
	},
	CL: { pattern: /^(CL)?\d{8}-\d{1}$/ },
	CO: { pattern: /^(CO)?\d{10}$/ },
	CR: { pattern: /^(CR)?\d{9,12}$/ },
	EC: { pattern: /^(EC)?\d{13}$/ },
	SV: { pattern: /^(SV)?\d{4}-\d{6}-\d{3}-\d{1}$/ },
	GT: { pattern: /^(GT)?\d{7}-\d{1}$/ },
	HN: { pattern: /^(HN)?$/ },
	MX: { pattern: /^(MX)?\w{3,4}\d{6}\w{3}$/ },
	NI: { pattern: /^(NI)?\d{3}-\d{6}-\d{4}\w{1}$/ },
	PA: { pattern: /^(PA)?$/ },
	PY: { pattern: /^(PY)?\d{6,8}-\d{1}$/ },
	PE: { pattern: /^(PE)?\d{11}$/ },
	DO: {
		pattern:
			/^(DO)?(\d{11}|(\d{3}-\d{7}-\d{1})|[1,4,5]{1}\d{8}|([1,4,5]{1})-\d{2}-\d{5}-\d{1})$/,
	},
	UY: { pattern: /^(UY)?\d{12}$/ },
	VE: { pattern: /^(VE)?[J,G,V,E]{1}-(\d{9}|(\d{8}-\d{1}))$/ },
	GR: { pattern: /^(GR)?\d{9}$/, legacy: /^(?:EL|GR)\d{9}$/i },
};
