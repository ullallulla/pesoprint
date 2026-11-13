/**
 * Who runs the shop, as shown in the terms and privacy policy. Placeholders until it's decided
 * (whose name, sole trader / toiminimi or company): fill these in before the public launch.
 */
export const OPERATOR = {
    /** Person or company name, e.g. "Matti Meikäläinen" or "Pesoprint Oy". */
    name: '[Operator name]',
    /** Finnish Business ID (Y-tunnus), if there is one. */
    businessId: '[Business ID]',
    address: '[Postal address]',
    email: '[contact email]',
} as const;

/** Change when the content of the terms or privacy policy changes. */
export const LEGAL_UPDATED = '2026-11-12';

const TOKENS: Record<string, string> = {
    operatorName: OPERATOR.name,
    businessId: OPERATOR.businessId,
    address: OPERATOR.address,
    email: OPERATOR.email,
    updated: LEGAL_UPDATED,
};

/** Fills `{{token}}` placeholders in a legal text. An unknown token is a mistake in the text, so it throws. */
export function fillLegalText(text: string, tokens: Record<string, string> = TOKENS): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
        const value = tokens[name];
        if (value === undefined) throw new Error(`Unknown placeholder {{${name}}} in a legal text.`);
        return value;
    });
}
