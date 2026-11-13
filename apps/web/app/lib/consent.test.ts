import { expect, test } from 'vite-plus/test';

import { analyticsCookieNames, consentCookie, readConsent } from './consent';

test('reads the stored choice from a cookie header', () => {
    expect(readConsent('a=1; pesoprint_consent=granted; b=2')).toBe('granted');
    expect(readConsent('pesoprint_consent=denied')).toBe('denied');
});

test("no answer yet, or an unknown value, means the visitor hasn't chosen", () => {
    expect(readConsent(null)).toBeNull();
    expect(readConsent('')).toBeNull();
    expect(readConsent('other=granted')).toBeNull();
    expect(readConsent('pesoprint_consent=yes')).toBeNull();
    expect(readConsent('xpesoprint_consent=granted')).toBeNull();
});

test('the cookie lasts six months for the whole site, and is Secure on HTTPS', () => {
    expect(consentCookie('granted', { secure: true })).toBe(
        'pesoprint_consent=granted; Path=/; Max-Age=15552000; SameSite=Lax; Secure',
    );
    expect(consentCookie('denied', { secure: false })).toBe(
        'pesoprint_consent=denied; Path=/; Max-Age=15552000; SameSite=Lax',
    );
});

test("finds PostHog's cookies, and only those", () => {
    expect(
        analyticsCookieNames('pesoprint_consent=denied; ph_phc_abc_posthog=%7B%7D; __session=x; __ph_opt_in_out_phc=0'),
    ).toEqual(['ph_phc_abc_posthog', '__ph_opt_in_out_phc']);
});
