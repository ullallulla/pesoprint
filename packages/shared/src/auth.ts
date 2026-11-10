import { z } from 'zod';

/** Roles come from Clerk `publicMetadata.role`; anyone without a role is a customer. */
export const userRoleSchema = z.enum(['customer', 'creator', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Response of `GET /api/me`: who the API thinks the caller is. */
export const meResponseSchema = z
    .object({
        userId: z.string(),
        role: userRoleSchema,
    })
    .meta({ id: 'MeResponse' });
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Response of `GET /api/admin/overview`, an admin-only endpoint. */
export const adminOverviewSchema = z
    .object({
        userCount: z.number().int().nonnegative(),
    })
    .meta({ id: 'AdminOverview' });
export type AdminOverview = z.infer<typeof adminOverviewSchema>;
