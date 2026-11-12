import { SignInButton } from '@clerk/react-router';
import { getAuth } from '@clerk/react-router/server';
import { cn } from 'cn';
import { data, isRouteErrorResponse, Link, NavLink, Outlet } from 'react-router';

import { Button } from '~/components/ui/button';

import type { Route } from './+types/layout';

export const meta: Route.MetaFunction = () => [{ title: 'Admin – Pesoprint' }, { name: 'robots', content: 'noindex' }];

// Every admin page loads its data from the API with the user's token, and the API checks the role.
// This only turns away visitors who aren't signed in at all, before any API call.
export async function loader(args: Route.LoaderArgs) {
    const { isAuthenticated } = await getAuth(args);
    if (!isAuthenticated) {
        throw data('Sign in required', { status: 401 });
    }
    return null;
}

const sections = [
    { to: '/admin', label: 'Overview', end: true },
    { to: '/admin/products', label: 'Products', end: false },
    { to: '/admin/categories', label: 'Categories', end: false },
];

export default function AdminLayout() {
    return (
        <div className='mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8'>
            <nav aria-label='Admin' className='flex gap-1 border-b'>
                {sections.map((section) => (
                    <NavLink
                        key={section.to}
                        to={section.to}
                        end={section.end}
                        className={({ isActive }) =>
                            cn(
                                '-mb-px border-b-2 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                                isActive ? 'border-primary text-foreground' : 'border-transparent',
                            )
                        }
                    >
                        {section.label}
                    </NavLink>
                ))}
            </nav>
            <Outlet />
        </div>
    );
}

// Catches errors from every admin page. Rendered inside <ClerkProvider>, so it can offer a sign-in button.
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
            ) : status === 404 ? (
                <>
                    <h1 className='text-3xl font-bold'>Not found</h1>
                    <p className='text-muted-foreground'>It may have been deleted.</p>
                    <Button asChild variant='outline'>
                        <Link to='/admin'>Back to the dashboard</Link>
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
