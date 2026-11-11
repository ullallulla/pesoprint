import { LICENSE_IDS, OWN_LICENSES, SLUG_PATTERN } from '@app/shared';
import { sql } from 'drizzle-orm';
import {
    bigint,
    check,
    customType,
    index,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
    timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date());

/** Time-ordered UUID (Postgres 18+). Not guessable like a serial, and indexes like one. */
const id = () =>
    uuid('id')
        .primaryKey()
        .default(sql`uuidv7()`);

export const userRole = pgEnum('user_role', ['customer', 'creator', 'admin']);

/**
 * Users mirrored from Clerk (via webhook). Clerk owns authentication;
 * this table lets orders, reviews and favourites reference a user.
 */
export const users = pgTable('users', {
    /** Clerk user id, e.g. `user_2abc...` */
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    displayName: text('display_name'),
    role: userRole('role').notNull().default('customer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * Catalogue categories. At most two levels (parent → child); the category service
 * enforces the depth and rejects cycles, the database only stops a category being its own parent.
 */
export const categories = pgTable(
    'categories',
    {
        id: id(),
        /** Globally unique, so `/categories/:slug` survives moving a category under another parent. */
        slug: text('slug').notNull().unique(),
        name: text('name').notNull(),
        /** Category page intro and meta description. */
        description: text('description'),
        parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, { onDelete: 'restrict' }),
        /** Manual ordering in menus, lowest first. */
        position: integer('position').notNull().default(0),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        check('categories_slug_format', sql`${t.slug} ~ '${sql.raw(SLUG_PATTERN)}'`),
        check('categories_not_own_parent', sql`${t.parentId} <> ${t.id}`),
        index('categories_parent_id_idx').on(t.parentId),
    ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export const productStatus = pgEnum('product_status', ['draft', 'published', 'archived']);
export const license = pgEnum('license', LICENSE_IDS);

const tsvector = customType<{ data: string }>({
    dataType: () => 'tsvector',
});

const ownLicenseList = sql.raw(OWN_LICENSES.map((l) => `'${l}'`).join(', '));

/**
 * A model in the catalogue. All prices are integer euro cents, **including VAT**
 * (what the consumer sees); checkout backs the VAT out per country.
 */
export const products = pgTable(
    'products',
    {
        id: id(),
        /** `/models/:slug`. */
        slug: text('slug').notNull().unique(),
        creatorId: text('creator_id')
            .notNull()
            .references(() => users.id, { onDelete: 'restrict' }),
        /** Optional on drafts, required to publish. */
        categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }),
        title: text('title').notNull(),
        /** Markdown. Render without raw HTML. */
        description: text('description').notNull().default(''),
        status: productStatus('status').notNull().default('draft'),
        /**
         * The digital file offer. `null` = file not offered (print only), `0` = free download, `> 0` = paid.
         * Don't test it for truthiness: `0` and `null` mean different things.
         */
        digitalPriceCents: integer('digital_price_cents'),
        /** Price of a physical print before the material surcharge. `null` = not offered as a print. */
        printBasePriceCents: integer('print_base_price_cents'),
        /** Required to publish when a file is offered. Paid files must use one of the shop's own licences. */
        license: license('license'),
        /** Printed size in millimetres. */
        sizeXMm: integer('size_x_mm'),
        sizeYMm: integer('size_y_mm'),
        sizeZMm: integer('size_z_mm'),
        /** Filament weight in grams, for shipping weight and a later pricing formula. */
        printWeightG: integer('print_weight_g'),
        /** `null` = not featured. Home page shows featured products newest-first by this. */
        featuredAt: timestamp('featured_at', { withTimezone: true }),
        /** Full-text search over title (weight A) and description (weight B). Maintained by Postgres. */
        searchVector: tsvector('search_vector').generatedAlwaysAs(
            sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', description), 'B')`,
        ),
        /** First publication. Kept when a product is archived. */
        publishedAt: timestamp('published_at', { withTimezone: true }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        check('products_slug_format', sql`${t.slug} ~ '${sql.raw(SLUG_PATTERN)}'`),
        check('products_digital_price_non_negative', sql`${t.digitalPriceCents} >= 0`),
        check('products_print_price_positive', sql`${t.printBasePriceCents} > 0`),
        check(
            'products_paid_file_own_license',
            sql`${t.digitalPriceCents} = 0 OR ${t.license} IS NULL OR ${t.license} IN (${ownLicenseList})`,
        ),
        check(
            'products_dimensions_positive',
            sql`${t.sizeXMm} > 0 AND ${t.sizeYMm} > 0 AND ${t.sizeZMm} > 0 AND ${t.printWeightG} > 0`,
        ),
        check(
            'products_publishable',
            sql`${t.status} <> 'published' OR (
                ${t.publishedAt} IS NOT NULL
                AND ${t.categoryId} IS NOT NULL
                AND (${t.digitalPriceCents} IS NOT NULL OR ${t.printBasePriceCents} IS NOT NULL)
                AND (${t.digitalPriceCents} IS NULL OR ${t.license} IS NOT NULL)
            )`,
        ),
        index('products_status_published_at_idx').on(t.status, t.publishedAt.desc()),
        index('products_category_id_idx').on(t.categoryId),
        index('products_creator_id_idx').on(t.creatorId),
        index('products_search_vector_idx').using('gin', t.searchVector),
    ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

/** Gallery images, stored in the public bucket. The cover is the lowest `position` (ties broken by id). */
export const productImages = pgTable(
    'product_images',
    {
        id: id(),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'cascade' }),
        /** Object key in storage, not a URL, so the storage provider can change. */
        storageKey: text('storage_key').notNull().unique(),
        alt: text('alt').notNull(),
        /** Pixel size, so the page can reserve the image's space before it loads. */
        width: integer('width').notNull(),
        height: integer('height').notNull(),
        sizeBytes: integer('size_bytes').notNull(),
        position: integer('position').notNull().default(0),
        createdAt: createdAt(),
    },
    (t) => [
        check('product_images_dimensions_positive', sql`${t.width} > 0 AND ${t.height} > 0 AND ${t.sizeBytes} > 0`),
        index('product_images_product_id_position_idx').on(t.productId, t.position),
    ],
);

export type ProductImage = typeof productImages.$inferSelect;
export type NewProductImage = typeof productImages.$inferInsert;

export const productFileKind = pgEnum('product_file_kind', ['download', 'preview']);
export const productFileFormat = pgEnum('product_file_format', ['stl', '3mf', 'step', 'obj', 'glb']);

/**
 * Model files. `download` files live in the private bucket and are served through signed URLs.
 * The `preview` GLB is public (the 3D viewer loads it), so it must be a decimated mesh,
 * never the full-resolution model.
 */
export const productFiles = pgTable(
    'product_files',
    {
        id: id(),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'cascade' }),
        kind: productFileKind('kind').notNull(),
        format: productFileFormat('format').notNull(),
        /** Original file name, used for Content-Disposition on download. */
        filename: text('filename').notNull(),
        storageKey: text('storage_key').notNull().unique(),
        /** bigint: model files can exceed the 2 GiB integer limit. */
        sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
        /** Lowercase hex SHA-256 of the file, if known. */
        sha256: text('sha256'),
        position: integer('position').notNull().default(0),
        createdAt: createdAt(),
    },
    (t) => [
        check('product_files_preview_is_glb', sql`${t.kind} <> 'preview' OR ${t.format} = 'glb'`),
        check('product_files_size_positive', sql`${t.sizeBytes} > 0`),
        check('product_files_sha256_format', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
        uniqueIndex('product_files_one_preview_idx')
            .on(t.productId)
            .where(sql`${t.kind} = 'preview'`),
        index('product_files_product_id_position_idx').on(t.productId, t.position),
    ],
);

export type ProductFile = typeof productFiles.$inferSelect;
export type NewProductFile = typeof productFiles.$inferInsert;
