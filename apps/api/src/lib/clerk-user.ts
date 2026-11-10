import type { UserJSON } from '@clerk/backend';

import type { NewUser } from '../db/schema.ts';
import { roleFromClaims } from './auth.ts';

/**
 * Maps a Clerk user (from a webhook) to our `users` row.
 * Returns null for users without an email address (e.g. phone-only sign-ups), which the shop can't serve.
 */
export function userFromClerk(data: UserJSON): NewUser | null {
    const primary =
        data.email_addresses.find((email) => email.id === data.primary_email_address_id) ?? data.email_addresses[0];
    if (!primary) {
        return null;
    }

    const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ');
    return {
        id: data.id,
        email: primary.email_address,
        displayName: fullName || data.username || null,
        role: roleFromClaims({ metadata: data.public_metadata }),
    };
}
