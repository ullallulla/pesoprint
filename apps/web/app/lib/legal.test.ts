import { expect, test } from 'vite-plus/test';

import privacy from '../content/privacy.md?raw';
import terms from '../content/terms.md?raw';
import { fillLegalText, LEGAL_UPDATED, OPERATOR } from './legal';

test('fills in the operator details', () => {
    expect(fillLegalText('Run by {{operatorName}}, {{email}}. Updated {{updated}}.')).toBe(
        `Run by ${OPERATOR.name}, ${OPERATOR.email}. Updated ${LEGAL_UPDATED}.`,
    );
});

test('a misspelt placeholder is an error, not text on the page', () => {
    expect(() => fillLegalText('{{emial}}')).toThrow('Unknown placeholder {{emial}}');
});

test.each([
    ['terms', terms],
    ['privacy', privacy],
])('the %s text only uses known placeholders and names the operator', (_, text) => {
    const filled = fillLegalText(text);
    expect(filled).not.toMatch(/\{\{/);
    expect(filled).toContain(OPERATOR.name);
    expect(filled).toContain(OPERATOR.email);
});

test('the privacy policy has the sections the cookie banner links to', () => {
    expect(privacy).toContain('## Cookies {#cookies}');
    expect(privacy).toMatch(/^### .* \{#analytics\}$/m);
});
