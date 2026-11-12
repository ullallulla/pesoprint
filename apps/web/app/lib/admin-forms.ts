import {
    MAX_PRICE_CENTS,
    updateCategorySchema,
    updateProductSchema,
    type ApiErrorIssue,
    type UpdateCategory,
    type UpdateProduct,
} from '@app/shared';
import type { z } from 'zod';

/**
 * Helpers that turn admin form fields into API request bodies. They validate with the same
 * shared schemas as the API, so most mistakes are shown next to the field without a round trip.
 */

/** Field name → message, for showing errors next to the inputs. */
export type FieldErrors = Record<string, string>;

/** The first message for each path. The API and zod both report paths like `slug` or `sizeXMm`. */
export function fieldErrors(issues: readonly ApiErrorIssue[] | undefined): FieldErrors {
    const errors: FieldErrors = {};
    for (const issue of issues ?? []) {
        errors[issue.path] ??= issue.message;
    }
    return errors;
}

function zodIssues(error: z.ZodError): ApiErrorIssue[] {
    return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/** `"Fidget Cube (v2)"` → `"fidget-cube-v2"`. Accents are dropped: `"Café"` → `"cafe"`. */
export function slugify(text: string): string {
    return text
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100)
        .replace(/-+$/, '');
}

/**
 * Parses a price typed in euros: `"12"`, `"12.5"`, `"12,50"`, `"€ 12.50"` → cents.
 * `null` for anything that isn't a non-negative amount with at most two decimals.
 */
export function parseEuros(input: string): number | null {
    const text = input.replace(/[€\s]/g, '').replace(',', '.');
    const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) return null;
    return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** `1250` → `"12.50"`, for the default value of a price input. */
export function centsToEuros(cents: number | null): string {
    return cents === null ? '' : (cents / 100).toFixed(2);
}

/** How the model file is offered, as chosen in the product form. */
export type FileOffer = 'none' | 'free' | 'paid';

export function fileOfferOf(digitalPriceCents: number | null): FileOffer {
    return digitalPriceCents === null ? 'none' : digitalPriceCents === 0 ? 'free' : 'paid';
}

/** A text field's value, untrimmed. Empty for a missing field or a file. */
export function formValue(form: FormData, name: string): string {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
}

const text = (form: FormData, name: string) => formValue(form, name).trim();

/** An optional whole number: empty → `null`, otherwise a number (which the schema checks). */
const optionalInt = (form: FormData, name: string): number | null => {
    const value = text(form, name);
    return value === '' ? null : Number(value);
};

type Parsed<T> = { ok: true; data: T } | { ok: false; issues: ApiErrorIssue[] };

/** The product form → a PATCH body with every field, so the saved product matches the form exactly. */
export function parseProductForm(form: FormData): Parsed<UpdateProduct> {
    const issues: ApiErrorIssue[] = [];

    const price = (name: string, path: string, emptyMessage: string): number | null => {
        const value = text(form, name);
        if (value === '') {
            issues.push({ path, message: emptyMessage });
            return null;
        }
        const cents = parseEuros(value);
        if (cents === null || cents > MAX_PRICE_CENTS) {
            issues.push({ path, message: 'Enter an amount in euros, like 4.50 (at most €10,000).' });
        }
        return cents;
    };

    let digitalPriceCents: number | null = null;
    const fileOffer = text(form, 'fileOffer');
    if (fileOffer === 'free') digitalPriceCents = 0;
    if (fileOffer === 'paid') {
        digitalPriceCents = price('digitalPrice', 'digitalPriceCents', 'Enter the price of the file.');
        if (digitalPriceCents === 0) {
            issues.push({ path: 'digitalPriceCents', message: 'A paid file costs more than €0. Choose "Free".' });
        }
    }

    let printBasePriceCents: number | null = null;
    if (form.get('offerPrint') === 'on') {
        printBasePriceCents = price('printPrice', 'printBasePriceCents', 'Enter the starting price of a print.');
        if (printBasePriceCents === 0) {
            issues.push({ path: 'printBasePriceCents', message: 'A print costs more than €0.' });
        }
    }

    const input = {
        title: text(form, 'title'),
        slug: text(form, 'slug'),
        // Keep the author's line breaks and indentation: it's markdown.
        description: formValue(form, 'description').replace(/\r\n/g, '\n'),
        categoryId: text(form, 'categoryId') || null,
        digitalPriceCents,
        printBasePriceCents,
        license: text(form, 'license') || null,
        sizeXMm: optionalInt(form, 'sizeXMm'),
        sizeYMm: optionalInt(form, 'sizeYMm'),
        sizeZMm: optionalInt(form, 'sizeZMm'),
        printWeightG: optionalInt(form, 'printWeightG'),
    };

    const parsed = updateProductSchema.safeParse(input);
    if (!parsed.success) {
        // Price problems were already explained in euros; skip zod's messages about cents.
        const pricePaths = new Set(issues.map((issue) => issue.path));
        issues.push(...zodIssues(parsed.error).filter((issue) => !pricePaths.has(issue.path)));
    }
    if (issues.length > 0 || !parsed.success) return { ok: false, issues };
    return { ok: true, data: parsed.data };
}

/** The new-product form: a title, and a slug made from it when left empty. */
export function parseNewProductForm(form: FormData): Parsed<{ title: string; slug: string }> {
    const title = text(form, 'title');
    const slug = text(form, 'slug') || slugify(title);
    const parsed = updateProductSchema.pick({ title: true, slug: true }).required().safeParse({ title, slug });
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, issues: zodIssues(parsed.error) };
}

/** The category form → a body for create (POST) or update (PATCH); both take every field. */
export function parseCategoryForm(
    form: FormData,
): Parsed<Required<Pick<UpdateCategory, 'name' | 'slug'>> & UpdateCategory> {
    const name = text(form, 'name');
    const position = text(form, 'position');
    const parsed = updateCategorySchema.required({ name: true, slug: true }).safeParse({
        name,
        slug: text(form, 'slug') || slugify(name),
        description: text(form, 'description') || null,
        parentId: text(form, 'parentId') || null,
        position: position === '' ? 0 : Number(position),
    });
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, issues: zodIssues(parsed.error) };
}

export type ImageMove = 'first' | 'earlier' | 'later';

/**
 * The gallery order after moving one image, as `{ id, position }` for each image whose position changes.
 * Positions are renumbered 0…n-1, so gaps left by deleted images disappear on the first move.
 */
export function reorderImages(
    images: readonly { id: string; position: number }[],
    id: string,
    move: ImageMove,
): { id: string; position: number }[] {
    const order = [...images];
    const from = order.findIndex((image) => image.id === id);
    if (from === -1) return [];
    const to = move === 'first' ? 0 : move === 'earlier' ? Math.max(0, from - 1) : Math.min(order.length - 1, from + 1);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved!);
    return order
        .map((image, position) => ({ id: image.id, position, changed: image.position !== position }))
        .filter((image) => image.changed)
        .map(({ id: imageId, position }) => ({ id: imageId, position }));
}
