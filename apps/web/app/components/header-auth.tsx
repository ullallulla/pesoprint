import { Show, SignInButton, UserButton, useUser } from '@clerk/react-router';
import { LayoutDashboard } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '~/components/ui/button';

/** Sign-in button for visitors; admin link and user menu for signed-in users. */
export function HeaderAuth() {
    return (
        <>
            <Show when='signed-out'>
                <SignInButton mode='modal'>
                    <Button size='sm'>Sign in</Button>
                </SignInButton>
            </Show>
            <Show when='signed-in'>
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
