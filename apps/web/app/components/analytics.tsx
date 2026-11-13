import { X } from 'lucide-react';
import { createContext, use, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { Button } from '~/components/ui/button';
import { clearAnalyticsStorage, startAnalytics, stopAnalytics, type AnalyticsConfig } from '~/lib/analytics';
import { consentCookie, type Consent } from '~/lib/consent';

interface AnalyticsState {
    consent: Consent | null;
    openSettings: () => void;
}

// Null outside <Analytics> (error pages) and when analytics aren't configured: nothing to ask about.
const AnalyticsContext = createContext<AnalyticsState | null>(null);

/**
 * Asks before any statistics cookies are set, and only then loads PostHog. Without a PostHog key
 * (e.g. locally) there are no optional cookies, so there is no banner and no settings link either.
 */
export function Analytics({
    config,
    initialConsent,
    children,
}: {
    config: AnalyticsConfig | null;
    /** From the consent cookie, read on the server so the banner is in the first render (no flash). */
    initialConsent: Consent | null;
    children: React.ReactNode;
}) {
    const [consent, setConsent] = useState(initialConsent);
    const [settingsOpen, setSettingsOpen] = useState(false);

    useEffect(() => {
        if (!config) return;
        if (consent === 'granted') {
            void startAnalytics(config);
        } else {
            // Also removes anything left over from before consent was withdrawn.
            clearAnalyticsStorage();
        }
    }, [config, consent]);

    if (!config) return children;

    function choose(next: Consent) {
        document.cookie = consentCookie(next, { secure: window.location.protocol === 'https:' });
        setSettingsOpen(false);
        if (consent === 'granted' && next === 'denied') {
            // Reloads the page.
            void stopAnalytics();
            return;
        }
        setConsent(next);
    }

    return (
        <AnalyticsContext value={{ consent, openSettings: () => setSettingsOpen(true) }}>
            {children}
            {(consent === null || settingsOpen) && (
                <ConsentBanner
                    consent={consent}
                    reopened={settingsOpen}
                    onChoose={choose}
                    onClose={() => setSettingsOpen(false)}
                />
            )}
        </AnalyticsContext>
    );
}

/**
 * Not a modal: the site stays usable while it's open. Allow and Decline are equally easy, as consent
 * rules require, and nothing optional runs until the visitor picks one.
 */
export function ConsentBanner({
    consent,
    reopened = false,
    onChoose,
    onClose,
}: {
    consent: Consent | null;
    /** Opened from "Cookie settings": takes focus, and can be closed without changing the choice. */
    reopened?: boolean;
    onChoose: (consent: Consent) => void;
    onClose?: () => void;
}) {
    const headingRef = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        if (reopened) headingRef.current?.focus();
    }, [reopened]);

    return (
        <section
            aria-labelledby='consent-heading'
            className='fixed inset-x-0 bottom-0 z-50 border-t bg-background p-4 shadow-lg sm:inset-x-auto sm:bottom-4 sm:left-4 sm:max-w-md sm:rounded-lg sm:border'
        >
            <div className='flex items-start justify-between gap-4'>
                <h2 id='consent-heading' ref={headingRef} tabIndex={-1} className='font-semibold outline-none'>
                    Allow statistics cookies?
                </h2>
                {reopened && onClose && (
                    <Button variant='ghost' size='icon-sm' className='-mt-1 -mr-2' onClick={onClose}>
                        <X aria-hidden />
                        <span className='sr-only'>Close</span>
                    </Button>
                )}
            </div>
            <p className='mt-2 text-sm text-muted-foreground'>
                We&apos;d like to use PostHog to count visits and see which pages and models people look at, so we can
                make the site better. It sets cookies, and it only runs if you allow it. You can change your mind any
                time under &ldquo;Cookie settings&rdquo; at the bottom of every page.{' '}
                <Link to='/privacy#cookies' className='underline underline-offset-4 hover:text-foreground'>
                    Privacy policy
                </Link>
            </p>
            {consent && (
                <p className='mt-2 text-sm'>
                    Right now statistics are <strong>{consent === 'granted' ? 'allowed' : 'declined'}</strong>.
                </p>
            )}
            <div className='mt-4 grid grid-cols-2 gap-2'>
                <Button variant='outline' onClick={() => onChoose('denied')}>
                    Decline
                </Button>
                <Button variant='outline' onClick={() => onChoose('granted')}>
                    Allow
                </Button>
            </div>
        </section>
    );
}

/** Footer link that reopens the banner. Rendered only when there is something to consent to. */
export function CookieSettingsButton({ className }: { className?: string }) {
    const analytics = use(AnalyticsContext);
    if (!analytics) return null;
    return (
        <button type='button' className={className} onClick={analytics.openSettings}>
            Cookie settings
        </button>
    );
}
