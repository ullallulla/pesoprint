import { adminOverviewSchema } from '@app/shared';
import { SignInButton } from '@clerk/react-router';
import { getAuth } from '@clerk/react-router/server';
import { Users } from 'lucide-react';
import { data, isRouteErrorResponse, Link } from 'react-router';

import { Button } from '~/components/ui/button';
import { apiFetch, ApiRequestError } from '~/lib/api.server';

import type { Route } from './+types/admin';

export const meta: Route.MetaFunction = () => [{ title: 'Admin – Pesoprint' }, { name: 'robots', content: 'noindex' }];

export async function loader(args: Route.LoaderArgs) {
    const { isAuthenticated, getToken } = await getAuth(args);
    if (!isAuthenticated) {
        throw data('Sign in required', { status: 401 });
    }

    try {
        // The API decides whether this user is an admin, based on their Clerk session token.
        const overview = await apiFetch('/api/admin/overview', adminOverviewSchema, { token: await getToken() });
        return { overview };
    } catch (error) {
        if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
            throw data(error.message, { status: error.status });
        }
        throw error;
    }
}

export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
    const { overview } = loaderData;

    return (
        <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-12'>
            <div className='space-y-1'>
                <h1 className='text-3xl font-bold tracking-tight'>Admin dashboard</h1>
                <p className='text-muted-foreground'>Models, orders and settings arrive here in the next milestones.</p>
            </div>

            <section className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                <div className='rounded-lg border p-4'>
                    <p className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                        <Users className='size-4' aria-hidden /> Users
                    </p>
                    <p className='mt-2 text-3xl font-bold'>{overview.userCount}</p>
                </div>
            </section>
        </main>
    );
}

// Rendered inside <ClerkProvider>, so it can offer a sign-in button.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    const status = isRouteErrorResponse(error) ? error.status : 500;

    return (
        <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col items-start gap-4 px-4 py-16'>
            {status === 401 ? (
                <>
                    <h1 className='text-3xl font-bold'>Sign in required</h1>
                    <p className='text-muted-foreground'>Sign in with an admin account to open the dashboard.</p>
                    <SignInButton mode='modal'>
                        <Button>Sign in</Button>
                    </SignInButton>
                </>
            ) : status === 403 ? (
                <>
                    <h1 className='text-3xl font-bold'>No access</h1>
                    <p className='text-muted-foreground'>Your account doesn't have admin rights.</p>
                    <Button asChild variant='outline'>
                        <Link to='/'>Back to home</Link>
                    </Button>
                </>
            ) : (
                <>
                    <h1 className='text-3xl font-bold'>The dashboard couldn't load</h1>
                    <p className='text-muted-foreground'>The API may be down. Try again in a moment.</p>
                </>
            )}
        </main>
    );
}
