import { z } from 'zod';

import { slugSchema } from './slug.ts';

export const categorySchema = z
    .object({
        id: z.uuid(),
        slug: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        /** `null` for a top-level category. Categories nest at most two levels deep. */
        parentId: z.uuid().nullable(),
        /** Manual ordering among siblings, lowest first. */
        position: z.int().nonnegative(),
    })
    .meta({ id: 'Category' });
export type Category = z.infer<typeof categorySchema>;

/** A category as listed in the admin, with how many products (of any status) it holds. */
export const adminCategorySchema = categorySchema
    .extend({ productCount: z.int().nonnegative() })
    .meta({ id: 'AdminCategory' });
export type AdminCategory = z.infer<typeof adminCategorySchema>;

export const adminCategoryListSchema = z
    .object({ categories: z.array(adminCategorySchema) })
    .meta({ id: 'AdminCategoryList' });
export type AdminCategoryList = z.infer<typeof adminCategoryListSchema>;

const categoryInputFields = z.object({
    slug: slugSchema,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1000).nullable().optional(),
    /** Must be a top-level category. `null` moves the category to the top level. */
    parentId: z.uuid().nullable().optional(),
    position: z.int().min(0).max(10_000).optional(),
});

export const createCategorySchema = categoryInputFields.meta({ id: 'CreateCategory' });
export type CreateCategory = z.infer<typeof createCategorySchema>;

/** Only the fields that are present change. `description: null` and `parentId: null` clear them. */
export const updateCategorySchema = categoryInputFields.partial().meta({ id: 'UpdateCategory' });
export type UpdateCategory = z.infer<typeof updateCategorySchema>;
