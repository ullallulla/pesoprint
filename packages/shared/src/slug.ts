import { z } from 'zod';

/**
 * Lowercase words joined by single hyphens, e.g. `articulated-dragon`.
 * The database CHECK constraints on `categories.slug` and `products.slug` use the same pattern.
 */
export const SLUG_PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*$';

export const slugSchema = z
    .string()
    .max(100)
    .regex(new RegExp(SLUG_PATTERN), 'Use lowercase letters and numbers, separated by single hyphens.');
