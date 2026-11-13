import { ClerkProvider } from '@clerk/react-router';
import { clerkMiddleware, rootAuthLoader } from '@clerk/react-router/server';
import {
    isRouteErrorResponse,
    Link,
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    useNavigation,
} from 'react-router';

import { Analytics } from '~/components/analytics';
import { HeaderAuth } from '~/components/header-auth';
import { SiteFooter } from '~/components/site-footer';
import { SiteHeader } from '~/components/site-header';
import { StartingUp } from '~/components/starting-up';
import { Button } from '~/components/ui/button';
import { getEnv } from '~/env.server';
import { isApiUnavailable } from '~/lib/api-unavailable';
import { readConsent } from '~/lib/consent';

import type { Route } from './+types/root';
// Served from this site rather than Google Fonts, so no visitor data goes to Google.
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/inter/opsz-italic.css';
import './app.css';

// Clerk reads the session cookie on every request; rootAuthLoader passes the auth state to the browser.
export const middleware: Route.MiddlewareFunction[] = [clerkMiddleware()];
export const loader = (args: Route.LoaderArgs) =>
    rootAuthLoader(args, ({ request }) => {
        const { POSTHOG_KEY, POSTHOG_HOST } = getEnv();
        return {
            analytics: POSTHOG_KEY ? { key: POSTHOG_KEY, host: POSTHOG_HOST } : null,
            consent: readConsent(request.headers.get('cookie')),
        };
    });

export function Layout({ children }: { children: React.ReactNode }) {
    return (
        <html lang='en'>
            <head>
                <meta charSet='utf-8' />
                <meta name='viewport' content='width=device-width, initial-scale=1' />
                <Meta />
                <Links />
            </head>
            <body className='flex min-h-screen flex-col'>
                {children}
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

export default function App({ loaderData }: Route.ComponentProps) {
    return (
        <ClerkProvider loaderData={loaderData}>
            <Analytics config={loaderData.analytics} initialConsent={loaderData.consent}>
                <NavigationProgress />
                <SiteHeader>
                    <HeaderAuth />
                </SiteHeader>
                <div className='flex flex-1 flex-col'>
                    <Outlet />
                </div>
                <SiteFooter />
            </Analytics>
        </ClerkProvider>
    );
}

/** A thin bar at the top of the page while the next page loads. */
function NavigationProgress() {
    const navigation = useNavigation();
    if (navigation.state === 'idle') return null;
    return (
        <div className='fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-primary/20' aria-hidden>
            <div className='nav-progress h-full w-1/3 bg-primary' />
        </div>
    );
}

// Renders outside <ClerkProvider> (the root loader may have failed), so the header has no sign-in here.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    if (isApiUnavailable(error)) {
        return (
            <>
                <SiteHeader />
                <StartingUp />
                <SiteFooter />
            </>
        );
    }

    let title = 'Something went wrong';
    let details = 'An unexpected error occurred. Please try again.';
    let stack: string | undefined;

    if (isRouteErrorResponse(error)) {
        if (error.status === 404) {
            title = 'Page not found';
            details = "The page you're looking for doesn't exist.";
        } else {
            title = `Error ${error.status}`;
            details = error.statusText || details;
        }
    } else if (import.meta.env.DEV && error instanceof Error) {
        details = error.message;
        stack = error.stack;
    }

    return (
        <>
            <SiteHeader />
            <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col items-start gap-4 px-4 py-16'>
                <h1 className='text-3xl font-bold'>{title}</h1>
                <p className='text-muted-foreground'>{details}</p>
                <Button asChild variant='outline'>
                    <Link to='/'>Back to home</Link>
                </Button>
                {stack && (
                    <pre className='w-full overflow-x-auto rounded-md bg-muted p-4 text-sm'>
                        <code>{stack}</code>
                    </pre>
                )}
            </main>
            <SiteFooter />
        </>
    );
}
