import type { License, ProductFileFormat, ProductStatus } from '@app/shared';
import { eq, inArray } from 'drizzle-orm';

import type { Database } from './client.ts';
import { categories, productFiles, productImages, products, users, type NewProduct } from './schema.ts';

/**
 * Sample catalogue for development and staging demos. Everything here is placeholder content:
 * the products, prices and descriptions are made up, and the storage keys point at objects that don't exist.
 *
 * Seed products belong to a dedicated "Sample Studio" user, so seeding again replaces them
 * without touching products you created yourself.
 */
export const SEED_CREATOR = {
    id: 'user_seed_sample_studio',
    email: 'sample-studio@example.com',
    displayName: 'Sample Studio',
    role: 'creator',
} as const;

interface SeedCategory {
    slug: string;
    name: string;
    description: string;
    children?: Omit<SeedCategory, 'children'>[];
}

const SEED_CATEGORIES: SeedCategory[] = [
    {
        slug: 'functional',
        name: 'Functional parts',
        description: 'Useful prints for around the house and workshop.',
        children: [
            { slug: 'desk-organisation', name: 'Desk organisation', description: 'Trays, stands and holders.' },
            { slug: 'cable-management', name: 'Cable management', description: 'Clips, guides and tidies.' },
            { slug: 'kitchen', name: 'Kitchen', description: 'Small helpers for the kitchen.' },
        ],
    },
    {
        slug: 'home-decor',
        name: 'Home & decor',
        description: 'Prints that make a room feel finished.',
        children: [
            { slug: 'planters', name: 'Planters', description: 'Pots and planters for small plants.' },
            { slug: 'wall-art', name: 'Wall art', description: 'Relief panels and hanging pieces.' },
        ],
    },
    {
        slug: 'toys-games',
        name: 'Toys & games',
        description: 'Things to play with.',
        children: [
            { slug: 'print-in-place', name: 'Print-in-place', description: 'Moving parts, no assembly needed.' },
            { slug: 'puzzles', name: 'Puzzles', description: 'Brain teasers and puzzle boxes.' },
        ],
    },
    { slug: 'miniatures', name: 'Miniatures', description: 'Small-scale figures and scenery.' },
];

interface SeedProduct {
    slug: string;
    title: string;
    category: string;
    /** `null` = no file, `0` = free, `> 0` = paid (VAT-inclusive cents). */
    file: number | null;
    print: number | null;
    license?: License;
    format?: ProductFileFormat;
    /** Width × depth × height in mm, and filament weight in grams. */
    size?: [number, number, number, number];
    images?: number;
    preview?: boolean;
    status?: ProductStatus;
    featured?: boolean;
}

// Listed newest first: the first product gets the most recent publication date.
const SEED_PRODUCTS: SeedProduct[] = [
    {
        slug: 'articulated-dragon',
        title: 'Articulated Dragon',
        category: 'print-in-place',
        file: 0,
        print: 2490,
        license: 'cc_by_nc',
        size: [180, 60, 25, 38],
        images: 3,
        preview: true,
        featured: true,
    },
    {
        slug: 'hex-desk-tray',
        title: 'Hex Desk Tray',
        category: 'desk-organisation',
        file: 450,
        print: 1890,
        license: 'standard_digital',
        format: '3mf',
        size: [140, 120, 30, 72],
        images: 2,
        preview: true,
        featured: true,
    },
    {
        slug: 'cable-clip-set',
        title: 'Cable Clip Set',
        category: 'cable-management',
        file: 0,
        print: 790,
        license: 'cc0',
        size: [20, 15, 12, 6],
        images: 2,
        featured: true,
    },
    {
        slug: 'geometric-planter',
        title: 'Geometric Planter',
        category: 'planters',
        file: 350,
        print: 2290,
        license: 'standard_digital',
        size: [110, 110, 95, 85],
        images: 3,
        preview: true,
        featured: true,
    },
    {
        slug: 'flexi-octopus',
        title: 'Flexi Octopus',
        category: 'print-in-place',
        file: 0,
        print: 1490,
        license: 'cc_by',
        size: [90, 90, 20, 22],
        images: 2,
        preview: true,
    },
    {
        slug: 'headphone-stand',
        title: 'Headphone Stand',
        category: 'desk-organisation',
        file: 300,
        print: 2690,
        license: 'commercial',
        format: 'step',
        size: [120, 100, 260, 140],
        images: 2,
    },
    {
        slug: 'spice-jar-rack',
        title: 'Spice Jar Rack',
        category: 'kitchen',
        file: 0,
        print: null,
        license: 'cc_by_sa',
        size: [200, 60, 80, 95],
        images: 1,
    },
    {
        slug: 'mountain-relief-panel',
        title: 'Mountain Relief Panel',
        category: 'wall-art',
        file: null,
        print: 3490,
        size: [250, 180, 15, 160],
        images: 3,
    },
    {
        slug: 'puzzle-box',
        title: 'Secret Puzzle Box',
        category: 'puzzles',
        file: 500,
        print: 2990,
        license: 'standard_digital',
        format: '3mf',
        size: [80, 80, 80, 110],
        images: 2,
        preview: true,
    },
    {
        slug: 'dice-tower',
        title: 'Dice Tower',
        category: 'toys-games',
        file: 0,
        print: 2190,
        license: 'cc_by_nc_sa',
        size: [90, 90, 200, 120],
        images: 2,
    },
    {
        slug: 'goblin-warband',
        title: 'Goblin Warband',
        category: 'miniatures',
        file: 650,
        print: null,
        license: 'standard_digital',
        size: [28, 28, 32, 4],
        images: 3,
    },
    {
        slug: 'under-desk-headphone-hook',
        title: 'Under-desk Headphone Hook',
        category: 'desk-organisation',
        file: 0,
        print: 990,
        license: 'gpl',
        size: [60, 40, 70, 18],
        images: 1,
    },
    {
        slug: 'self-watering-pot',
        title: 'Self-watering Pot',
        category: 'planters',
        file: null,
        print: 1990,
        size: [100, 100, 110, 90],
        images: 2,
    },
    {
        slug: 'bag-clip',
        title: 'Bag Clip',
        category: 'kitchen',
        file: 0,
        print: null,
        license: 'cc0',
        size: [90, 15, 12, 5],
        images: 1,
    },
    {
        slug: 'tangram-set',
        title: 'Tangram Set',
        category: 'puzzles',
        file: 0,
        print: 1290,
        license: 'cc_by',
        size: [100, 100, 6, 20],
        images: 1,
    },
    {
        slug: 'cable-tray',
        title: 'Under-desk Cable Tray',
        category: 'cable-management',
        file: 250,
        print: 2490,
        license: 'standard_digital',
        size: [300, 80, 60, 130],
        images: 2,
    },
    // Not public: shows the other statuses in the admin.
    {
        slug: 'ruined-tower-scenery',
        title: 'Ruined Tower Scenery',
        category: 'miniatures',
        file: 800,
        print: null,
        license: 'standard_digital',
        images: 1,
        status: 'archived',
    },
    {
        slug: 'wave-wall-hook',
        title: 'Wave Wall Hook',
        category: 'wall-art',
        file: 0,
        print: null,
        license: 'cc_by',
        images: 1,
        status: 'draft',
    },
    {
        slug: 'untitled-lamp-shade',
        title: 'Lamp Shade (work in progress)',
        category: 'home-decor',
        file: null,
        print: null,
        status: 'draft',
    },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function description(product: SeedProduct): string {
    return [
        `_Sample product for development. The photos, files and prices are placeholders._`,
        '',
        `${product.title} is a seed model in the ${product.category} category.`,
        '',
        '## Print settings',
        '',
        '- Layer height: 0.2 mm',
        '- Supports: none',
    ].join('\n');
}

export interface SeedResult {
    categories: number;
    products: number;
    images: number;
    files: number;
}

/** Writes the sample catalogue. Safe to run again: it replaces the previous seed products. */
export async function seedDatabase(db: Database, now = new Date()): Promise<SeedResult> {
    return db.transaction(async (tx) => {
        await tx
            .insert(users)
            .values(SEED_CREATOR)
            .onConflictDoUpdate({
                target: users.id,
                set: { email: SEED_CREATOR.email, displayName: SEED_CREATOR.displayName },
            });

        // Categories: parents first, so children can reference them. Matched by slug, so reruns update in place.
        const categoryIds = new Map<string, string>();
        const upsertCategory = async (
            category: Omit<SeedCategory, 'children'>,
            position: number,
            parentId: string | null,
        ) => {
            const values = {
                slug: category.slug,
                name: category.name,
                description: category.description,
                parentId,
                position,
            };
            const [row] = await tx
                .insert(categories)
                .values(values)
                .onConflictDoUpdate({ target: categories.slug, set: values })
                .returning({ id: categories.id });
            categoryIds.set(category.slug, row!.id);
        };
        for (const [position, parent] of SEED_CATEGORIES.entries()) {
            await upsertCategory(parent, position, null);
            for (const [childPosition, child] of (parent.children ?? []).entries()) {
                await upsertCategory(child, childPosition, categoryIds.get(parent.slug)!);
            }
        }

        // Products: replace every product owned by the seed creator (images and files cascade).
        await tx.delete(products).where(eq(products.creatorId, SEED_CREATOR.id));
        // A product of yours could hold a seed slug; free them so the inserts below don't collide.
        const seedSlugs = SEED_PRODUCTS.map((product) => product.slug);
        const taken = await tx.select({ slug: products.slug }).from(products).where(inArray(products.slug, seedSlugs));
        const takenSlugs = new Set(taken.map((row) => row.slug));

        const result: SeedResult = { categories: categoryIds.size, products: 0, images: 0, files: 0 };
        let featuredRank = 0;

        for (const [index, seed] of SEED_PRODUCTS.entries()) {
            if (takenSlugs.has(seed.slug)) continue;

            const status = seed.status ?? 'published';
            const publishedAt = status === 'draft' ? null : new Date(now.getTime() - (index + 1) * 2 * DAY_MS);
            const [width, depth, height, weight] = seed.size ?? [null, null, null, null];
            const values: NewProduct = {
                slug: seed.slug,
                title: seed.title,
                description: description(seed),
                creatorId: SEED_CREATOR.id,
                categoryId: categoryIds.get(seed.category)!,
                status,
                digitalPriceCents: seed.file,
                printBasePriceCents: seed.print,
                license: seed.license ?? null,
                sizeXMm: width,
                sizeYMm: depth,
                sizeZMm: height,
                printWeightG: weight,
                // Featured products keep the list order: the first one is the most recently featured.
                featuredAt: seed.featured ? new Date(now.getTime() - featuredRank++ * 60_000) : null,
                publishedAt,
                createdAt: new Date((publishedAt ?? now).getTime() - DAY_MS),
            };
            const [product] = await tx.insert(products).values(values).returning({ id: products.id });
            const productId = product!.id;
            result.products++;

            const imageCount = seed.images ?? 0;
            if (imageCount > 0) {
                await tx.insert(productImages).values(
                    Array.from({ length: imageCount }, (_, position) => ({
                        productId,
                        storageKey: `seed/products/${seed.slug}/image-${position + 1}.webp`,
                        alt: `${seed.title}, placeholder photo ${position + 1}`,
                        width: 1200,
                        height: 900,
                        sizeBytes: 150_000,
                        position,
                    })),
                );
                result.images += imageCount;
            }

            const files = [];
            if (seed.file !== null) {
                const format = seed.format ?? 'stl';
                files.push({
                    kind: 'download' as const,
                    format,
                    filename: `${seed.slug}.${format}`,
                    sizeBytes: 2_500_000,
                });
            }
            if (seed.preview) {
                files.push({
                    kind: 'preview' as const,
                    format: 'glb' as const,
                    filename: `${seed.slug}-preview.glb`,
                    sizeBytes: 400_000,
                });
            }
            if (files.length > 0) {
                await tx.insert(productFiles).values(
                    files.map((file, position) => ({
                        ...file,
                        productId,
                        storageKey: `seed/products/${seed.slug}/${file.filename}`,
                        position,
                    })),
                );
                result.files += files.length;
            }
        }

        return result;
    });
}
