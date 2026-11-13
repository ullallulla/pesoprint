import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, test } from 'vite-plus/test';

import { Analytics, ConsentBanner } from './analytics';
import { splitHeadingId } from './legal-page';
import { SiteFooter } from './site-footer';

const CONFIG = { key: 'phc_test', host: 'https://eu.i.posthog.com' };

function render(element: React.ReactNode) {
    const Stub = createRoutesStub([{ path: '/', Component: () => element }]);
    return renderToStaticMarkup(<Stub initialEntries={['/']} />);
}

function page(config: typeof CONFIG | null, consent: 'granted' | 'denied' | null) {
    return render(
        <Analytics config={config} initialConsent={consent}>
            <SiteFooter />
        </Analytics>,
    );
}

test("a first visit gets the banner with the page, so it doesn't pop in after loading", () => {
    const html = page(CONFIG, null);
    expect(html).toContain('Allow statistics cookies?');
    expect(html).toContain('href="/privacy#cookies"');
    expect(html).toContain('Cookie settings');
});

test('once the visitor has chosen, only the footer link remains', () => {
    for (const consent of ['granted', 'denied'] as const) {
        const html = page(CONFIG, consent);
        expect(html).not.toContain('Allow statistics cookies?');
        expect(html).toContain('Cookie settings');
    }
});

test('without PostHog configured there is nothing to ask about', () => {
    const html = page(null, null);
    expect(html).not.toContain('Allow statistics cookies?');
    expect(html).not.toContain('Cookie settings');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
});

test('Decline and Allow are equally easy: same kind of button, side by side', () => {
    const html = render(<ConsentBanner consent={null} onChoose={() => {}} />);
    const buttons = [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(\w+)<\/button>/g)];
    expect(buttons.map(([, , label]) => label)).toEqual(['Decline', 'Allow']);
    expect(buttons[0]![1]).toBe(buttons[1]![1]);
});

test('reopened from the footer, the banner shows the current choice and can be closed', () => {
    const html = render(<ConsentBanner consent='granted' reopened onChoose={() => {}} onClose={() => {}} />);
    expect(html).toContain('Right now statistics are <strong>allowed</strong>.');
    expect(html).toContain('Close');
});

test('legal headings can carry an id to link to', () => {
    expect(splitHeadingId('Cookies {#cookies}')).toEqual({ text: 'Cookies', id: 'cookies' });
    expect(splitHeadingId('Who we are')).toEqual({ text: 'Who we are' });
});
