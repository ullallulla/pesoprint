import {
    HEX_COLOUR_PATTERN,
    LICENSE_IDS,
    ORDER_CURRENCY,
    ORDER_ITEM_TYPES,
    ORDER_STATUSES,
    OWN_LICENSES,
    PARCEL_SIZES,
    PRODUCT_FILE_FORMATS,
    PRODUCT_FILE_KINDS,
    PRODUCT_STATUSES,
    SLUG_PATTERN,
} from '@app/shared';
import { sql } from 'drizzle-orm';
import {
    bigint,
    boolean,
    check,
    customType,
    index,
    integer,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    timestamp,
    unique,
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

export const productStatus = pgEnum('product_status', PRODUCT_STATUSES);
export const license = pgEnum('license', LICENSE_IDS);
export const parcelSize = pgEnum('parcel_size', PARCEL_SIZES);

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
        /**
         * The lowest price of a print among the model's active materials (`product_materials`), shown as
         * "Print from €X" and used to sort and filter. `null` = can't be ordered as a print. The products
         * service keeps it up to date; never set it directly.
         */
        printBasePriceCents: integer('print_base_price_cents'),
        /** The parcel a print ships in. Required to publish a model that can be printed. */
        parcelSize: parcelSize('parcel_size'),
        /** Required to publish when a file is offered. Paid files must use one of the shop's own licences. */
        license: license('license'),
        /** Printed size in millimetres. */
        sizeXMm: integer('size_x_mm'),
        sizeYMm: integer('size_y_mm'),
        sizeZMm: integer('size_z_mm'),
        /** Filament weight in grams. */
        printWeightG: integer('print_weight_g'),
        /** `null` = not featured. Home page shows featured products newest-first by this. */
        featuredAt: timestamp('featured_at', { withTimezone: true }),
        /** Full-text search over title (weight A) and description (weight B). Maintained by Postgres. */
        searchVector: tsvector('search_vector').generatedAlwaysAs(
            sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', description), 'B')`,
        ),
        /** First publication. Kept when a product is archived. */
        publishedAt: timestamp('published_at', { withTimezone: true }),
        /** Downloads by visitors and customers (not by admins or the creator). Kept up to date with `download_events`. */
        downloadCount: integer('download_count').notNull().default(0),
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
        check('products_download_count_non_negative', sql`${t.downloadCount} >= 0`),
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
                AND (${t.printBasePriceCents} IS NULL OR ${t.parcelSize} IS NOT NULL)
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

export const productFileKind = pgEnum('product_file_kind', PRODUCT_FILE_KINDS);
export const productFileFormat = pgEnum('product_file_format', PRODUCT_FILE_FORMATS);

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

/**
 * One row per download link handed out. Used for download counts, rate limiting and (M5) to let people
 * who downloaded a free model review it.
 */
export const downloadEvents = pgTable(
    'download_events',
    {
        id: id(),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'cascade' }),
        /** `null` once the file is deleted; the event still counts for the product. */
        fileId: uuid('file_id').references(() => productFiles.id, { onDelete: 'set null' }),
        /** The signed-in downloader, if any. */
        userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
        /**
         * HMAC of the IP address with a secret and the date, never the address itself: enough to rate-limit
         * one visitor within a day, but it can't be turned back into an IP or followed across days.
         */
        ipHash: text('ip_hash'),
        createdAt: createdAt(),
    },
    (t) => [
        index('download_events_product_id_idx').on(t.productId),
        index('download_events_ip_hash_created_at_idx').on(t.ipHash, t.createdAt),
        index('download_events_user_id_idx').on(t.userId),
    ],
);

export type DownloadEvent = typeof downloadEvents.$inferSelect;

export const orderStatus = pgEnum('order_status', ORDER_STATUSES);
export const orderItemType = pgEnum('order_item_type', ORDER_ITEM_TYPES);

/**
 * A purchase. Amounts are integer cents and include VAT, like catalogue prices; `taxCents` is the VAT
 * contained in the total, at `vatRateBp` (basis points: 2550 = 25.5 %) for `vatCountry`.
 *
 * Orders are bookkeeping records and outlive accounts: if the user is deleted, `userId` becomes null
 * and `email` still says who bought.
 */
export const orders = pgTable(
    'orders',
    {
        id: id(),
        userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
        /** The buyer's email when ordering (receipts, and the record after the account is gone). */
        email: text('email').notNull(),
        status: orderStatus('status').notNull().default('pending'),
        currency: text('currency').notNull().default(ORDER_CURRENCY),
        subtotalCents: integer('subtotal_cents').notNull(),
        taxCents: integer('tax_cents').notNull(),
        totalCents: integer('total_cents').notNull(),
        vatCountry: text('vat_country').notNull(),
        vatRateBp: integer('vat_rate_bp').notNull(),
        /** The Stripe Checkout Session the buyer pays on (`cs_…`), set once it's created. */
        stripeCheckoutSessionId: text('stripe_checkout_session_id').unique(),
        /** The Stripe payment (`pi_…`), set once paid: what a refund refers to. */
        stripePaymentIntentId: text('stripe_payment_intent_id').unique(),
        /** Stripe's own payment status (`unpaid`, `paid`…), for support. */
        paymentStatus: text('payment_status'),
        /** e.g. `card`, `mobilepay`, `klarna`, once paid. */
        paymentMethod: text('payment_method'),
        /**
         * When the buyer agreed that model files are delivered right away and that this ends their 14-day
         * right of withdrawal. Set on every order with a digital item: it's the record that the right was
         * waived.
         */
        immediateDeliveryConsentAt: timestamp('immediate_delivery_consent_at', { withTimezone: true }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
        paidAt: timestamp('paid_at', { withTimezone: true }),
    },
    (t) => [
        index('orders_user_id_created_at_idx').on(t.userId, t.createdAt),
        check('orders_currency_eur', sql`${t.currency} = '${sql.raw(ORDER_CURRENCY)}'`),
        check('orders_amounts_non_negative', sql`${t.subtotalCents} >= 0 AND ${t.taxCents} >= 0`),
        // No shipping yet (M4): the total is the items.
        check('orders_total_is_subtotal', sql`${t.totalCents} = ${t.subtotalCents}`),
        check('orders_tax_within_total', sql`${t.taxCents} <= ${t.totalCents}`),
        check('orders_vat_country_format', sql`${t.vatCountry} ~ '^[A-Z]{2}$'`),
        check('orders_vat_rate_range', sql`${t.vatRateBp} BETWEEN 0 AND 10000`),
        check('orders_paid_has_paid_at', sql`${t.status} NOT IN ('paid', 'refunded') OR ${t.paidAt} IS NOT NULL`),
    ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

/**
 * One line of an order, with the title, price and licence as they were when bought: later edits to the
 * product don't change what someone bought. A product with orders can't be deleted (archive it instead).
 */
export const orderItems = pgTable(
    'order_items',
    {
        id: id(),
        orderId: uuid('order_id')
            .notNull()
            .references(() => orders.id, { onDelete: 'cascade' }),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'restrict' }),
        type: orderItemType('type').notNull(),
        quantity: integer('quantity').notNull().default(1),
        unitPriceCents: integer('unit_price_cents').notNull(),
        titleSnapshot: text('title_snapshot').notNull(),
        licenseSnapshot: license('license_snapshot'),
    },
    (t) => [
        uniqueIndex('order_items_order_product_type_idx').on(t.orderId, t.productId, t.type),
        index('order_items_product_id_idx').on(t.productId),
        check('order_items_unit_price_non_negative', sql`${t.unitPriceCents} >= 0`),
        // A file is bought once; buying it twice would only charge twice.
        check('order_items_digital_quantity_one', sql`${t.type} <> 'digital' OR ${t.quantity} = 1`),
    ],
);

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;

/**
 * Who owns which model's files: granted when an order is paid. Buyers keep their files when the model
 * is archived or its files are replaced; `orderId` is null for files given without an order.
 */
export const entitlements = pgTable(
    'entitlements',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'restrict' }),
        orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
        grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.userId, t.productId] }), index('entitlements_product_id_idx').on(t.productId)],
);

export type Entitlement = typeof entitlements.$inferSelect;

/** What prints are made of (PLA, PETG…). Inactive materials are hidden from buyers but kept for past orders. */
export const materials = pgTable(
    'materials',
    {
        id: id(),
        name: text('name').notNull(),
        /** A line for buyers about what the material is good for. */
        description: text('description'),
        active: boolean('active').notNull().default(true),
        /** Several colours can be combined in one print. Off: only single-colour options are offered. */
        multicolour: boolean('multicolour').notNull().default(true),
        /** Order in lists, lowest first. */
        position: integer('position').notNull().default(0),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [uniqueIndex('materials_name_unique').on(sql`lower(${t.name})`)],
);

export type Material = typeof materials.$inferSelect;
export type NewMaterial = typeof materials.$inferInsert;

/** The colours prints come in. Which materials you have in each colour is in `material_colours`. */
export const colours = pgTable(
    'colours',
    {
        id: id(),
        name: text('name').notNull(),
        /** `#rrggbb`, lowercase. */
        hex: text('hex').notNull(),
        /** Order in lists, lowest first. */
        position: integer('position').notNull().default(0),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [
        check('colours_hex_format', sql`${t.hex} ~ '${sql.raw(HEX_COLOUR_PATTERN)}'`),
        uniqueIndex('colours_name_unique').on(sql`lower(${t.name})`),
    ],
);

export type Colour = typeof colours.$inferSelect;
export type NewColour = typeof colours.$inferInsert;

/**
 * The colours you have each material in: its filaments. An out-of-stock one stays listed but can't be
 * ordered.
 */
export const materialColours = pgTable(
    'material_colours',
    {
        materialId: uuid('material_id')
            .notNull()
            .references(() => materials.id, { onDelete: 'cascade' }),
        colourId: uuid('colour_id')
            .notNull()
            .references(() => colours.id, { onDelete: 'cascade' }),
        inStock: boolean('in_stock').notNull().default(true),
    },
    (t) => [
        primaryKey({ columns: [t.materialId, t.colourId] }),
        index('material_colours_colour_id_idx').on(t.colourId),
    ],
);

export type MaterialColourRow = typeof materialColours.$inferSelect;

/** The materials a model can be printed in, and the price of a print in each (euro cents, VAT included). */
export const productMaterials = pgTable(
    'product_materials',
    {
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'cascade' }),
        /** A material in use can't be deleted, only made inactive. */
        materialId: uuid('material_id')
            .notNull()
            .references(() => materials.id, { onDelete: 'restrict' }),
        priceCents: integer('price_cents').notNull(),
    },
    (t) => [
        primaryKey({ columns: [t.productId, t.materialId] }),
        index('product_materials_material_id_idx').on(t.materialId),
        check('product_materials_price_positive', sql`${t.priceCents} > 0`),
    ],
);

export type ProductMaterial = typeof productMaterials.$inferSelect;

/**
 * The colours a buyer can order a model's print in. A model without any is printed in the colours shown, and
 * the buyer only chooses the material.
 */
export const productColourOptions = pgTable(
    'product_colour_options',
    {
        id: id(),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'cascade' }),
        /** Order on the product page, lowest first. */
        position: integer('position').notNull().default(0),
    },
    (t) => [index('product_colour_options_product_id_idx').on(t.productId)],
);

export type ProductColourOption = typeof productColourOptions.$inferSelect;

/** The colours of a colour option, in order: one, or several for a multicolour print. */
export const productColourOptionColours = pgTable(
    'product_colour_option_colours',
    {
        optionId: uuid('option_id')
            .notNull()
            .references(() => productColourOptions.id, { onDelete: 'cascade' }),
        /** A colour in use can't be deleted, only marked out of stock. */
        colourId: uuid('colour_id')
            .notNull()
            .references(() => colours.id, { onDelete: 'restrict' }),
        position: integer('position').notNull(),
    },
    (t) => [
        primaryKey({ columns: [t.optionId, t.position] }),
        unique('product_colour_option_colours_option_id_colour_id_unique').on(t.optionId, t.colourId),
        index('product_colour_option_colours_colour_id_idx').on(t.colourId),
    ],
);
