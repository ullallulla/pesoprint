import { isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';

import { SiteFooter } from '~/components/site-footer';
import { SiteHeader } from '~/components/site-header';
import { Button } from '~/components/ui/button';

import type { Route } from './+types/root';
import './app.css';

export const links: Route.LinksFunction = () => [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
    {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap',
    },
];

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
                <SiteHeader />
                <div className='flex flex-1 flex-col'>{children}</div>
                <SiteFooter />
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

export default function App() {
    return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
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
    );
}
