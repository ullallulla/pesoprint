import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    DOWNLOAD_EXTENSIONS,
    IMAGE_CONTENT_TYPES,
    MAX_UPLOAD_BYTES,
    MODEL_CONTENT_TYPES,
    digitalPriceCentsSchema,
    fileExtension,
    licenseSchema,
    printBasePriceCentsSchema,
    slugSchema,
    type ImageContentType,
    type ProductFileFormat,
    type ProductFileKind,
} from '@app/shared';
import { imageSize } from 'image-size';
import { z } from 'zod';

import { ModelParseError, stlToPreview } from '../lib/model-preview.ts';

/** `source.json` in each model folder. See `seed-assets/README.md`. */
const sourceSchema = z
    .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().default(''),
        /** Slug of a seed category. */
        category: z.string(),
        digitalPriceCents: digitalPriceCentsSchema.optional(),
        printBasePriceCents: printBasePriceCentsSchema.optional(),
        license: licenseSchema.optional(),
        /** Printed size in mm: width, depth, height. */
        size: z.tuple([z.int().positive(), z.int().positive(), z.int().positive()]).optional(),
        printWeightG: z.int().positive().optional(),
        featured: z.boolean().default(false),
        /** Credit for designs that aren't the shop's own. */
        designer: z.string().optional(),
        url: z.url().optional(),
    })
    .strict();
export type SeedSource = z.infer<typeof sourceSchema>;

export interface SeedAssetImage {
    filename: string;
    body: Uint8Array;
    contentType: ImageContentType;
    width: number;
    height: number;
}

export interface SeedAssetFile {
    filename: string;
    body: Uint8Array;
    kind: ProductFileKind;
    format: ProductFileFormat;
    contentType: string;
}

export interface SeedAsset {
    /** The folder name. */
    slug: string;
    source: SeedSource;
    /** Sorted by file name; the first is the cover. */
    images: SeedAssetImage[];
    files: SeedAssetFile[];
}

const IMAGE_EXTENSIONS = new Map<string, ImageContentType>([
    ...Object.entries(IMAGE_CONTENT_TYPES).map(([type, ext]) => [ext, type as ImageContentType] as const),
    ['jpeg', 'image/jpeg'],
]);

/** Files that are allowed in a model folder but aren't uploaded. */
const IGNORED_FILES = new Set(['source.json', 'readme.md', '.ds_store', 'thumbs.db']);

/**
 * Reads every model folder in `dir`. Returns `[]` when the folder doesn't exist (fresh clones, CI).
 * Throws with the folder name on anything it can't use, so a typo doesn't silently drop a model.
 */
export async function loadSeedAssets(dir: string): Promise<SeedAsset[]> {
    if (!existsSync(dir)) return [];

    const entries = await readdir(dir, { withFileTypes: true });
    const folders = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((e) => e.name);
    const assets: SeedAsset[] = [];

    for (const slug of folders.sort()) {
        const fail = (message: string): never => {
            throw new Error(`seed-assets/${slug}: ${message}`);
        };
        if (!slugSchema.safeParse(slug).success) {
            fail('the folder name must be a slug (lowercase letters, numbers and single hyphens).');
        }

        const folder = join(dir, slug);
        let sourceJson: unknown;
        try {
            sourceJson = JSON.parse(await readFile(join(folder, 'source.json'), 'utf8'));
        } catch (error) {
            fail(`could not read source.json (${error instanceof Error ? error.message : String(error)}).`);
        }
        const parsed = sourceSchema.safeParse(sourceJson);
        if (!parsed.success) {
            fail(`invalid source.json:\n${z.prettifyError(parsed.error)}`);
        }

        const images: SeedAssetImage[] = [];
        const files: SeedAssetFile[] = [];
        const names = (await readdir(folder)).filter((name) => !name.startsWith('.')).sort();

        for (const filename of names) {
            if (IGNORED_FILES.has(filename.toLowerCase())) continue;
            const extension = fileExtension(filename);
            const body = new Uint8Array(await readFile(join(folder, filename)));

            const imageType = IMAGE_EXTENSIONS.get(extension);
            if (imageType) {
                if (body.byteLength > MAX_UPLOAD_BYTES.image) fail(`${filename} is larger than the image limit.`);
                const { width, height } = imageSize(body);
                images.push({ filename, body, contentType: imageType, width, height });
                continue;
            }

            const format = extension === 'glb' ? 'glb' : DOWNLOAD_EXTENSIONS[extension];
            if (!format) {
                fail(
                    `${filename}: unsupported file type. Use images (jpg, png, webp, avif) or models (stl, 3mf, step, obj, glb).`,
                );
            }
            const kind: ProductFileKind = format === 'glb' ? 'preview' : 'download';
            if (body.byteLength > MAX_UPLOAD_BYTES[kind]) fail(`${filename} is larger than the ${kind} limit.`);
            files.push({ filename, body, kind, format: format!, contentType: MODEL_CONTENT_TYPES[format!] });
        }

        if (files.filter((file) => file.kind === 'preview').length > 1) fail('only one .glb preview is allowed.');

        // No hand-made preview: make one from the first STL, as the admin does when an STL is uploaded.
        // Not for "no derivatives" licences: a reduced copy is a modified version of someone else's design.
        const noDerivatives = parsed.data!.license === 'cc_by_nd' || parsed.data!.license === 'cc_by_nc_nd';
        const stl = files.find((file) => file.format === 'stl');
        if (stl && !noDerivatives && !files.some((file) => file.kind === 'preview')) {
            try {
                const { glb } = await stlToPreview(stl.body);
                files.push({
                    filename: `${stl.filename.replace(/\.[^.]+$/, '')}-preview.glb`,
                    body: glb,
                    kind: 'preview',
                    format: 'glb',
                    contentType: MODEL_CONTENT_TYPES.glb,
                });
            } catch (error) {
                if (error instanceof ModelParseError) fail(`${stl.filename} could not be read: ${error.message}`);
                throw error;
            }
        }
        assets.push({ slug, source: parsed.data!, images, files });
    }

    return assets;
}
