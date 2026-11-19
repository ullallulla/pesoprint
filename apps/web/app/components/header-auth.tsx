import { Show, SignInButton, UserButton, useUser } from '@clerk/react-router';
import { Heart, LayoutDashboard, Library, Package } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '~/components/ui/button';

/** Sign-in button for visitors; favourites, orders, library, admin link and user menu for signed-in users. */
export function HeaderAuth() {
    return (
        <>
            <Show when='signed-out'>
                <SignInButton mode='modal'>
                    <Button size='sm'>Sign in</Button>
                </SignInButton>
            </Show>
            <Show when='signed-in'>
                <Button asChild variant='ghost' size='sm'>
                    <Link to='/favourites'>
                        <Heart aria-hidden />
                        {/* Icons only on phones, where the header is narrow. */}
                        <span className='sr-only sm:not-sr-only'>Favourites</span>
                    </Link>
                </Button>
                <Button asChild variant='ghost' size='sm'>
                    <Link to='/orders'>
                        <Package aria-hidden />
                        <span className='sr-only sm:not-sr-only'>Orders</span>
                    </Link>
                </Button>
                <Button asChild variant='ghost' size='sm'>
                    <Link to='/library'>
                        <Library aria-hidden />
                        <span className='sr-only sm:not-sr-only'>Library</span>
                    </Link>
                </Button>
                <AdminLink />
                <UserButton />
            </Show>
        </>
    );
}

/**
 * Only a convenience for the UI: anyone could fake their way to /admin,
 * but the API refuses admin data unless the session token says role = admin.
 */
function AdminLink() {
    const { user } = useUser();
    if (user?.publicMetadata.role !== 'admin') {
        return null;
    }
    return (
        <Button asChild variant='ghost' size='sm'>
            <Link to='/admin'>
                <LayoutDashboard aria-hidden />
                Admin
            </Link>
        </Button>
    );
}
