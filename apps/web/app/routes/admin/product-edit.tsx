import {
    adminCategoryListSchema,
    adminColourListSchema,
    adminMaterialListSchema,
    adminProductFileSchema,
    adminProductImageSchema,
    adminProductSchema,
    colourOptionName,
    MAX_OPTION_COLOURS,
    PARCEL_SIZES,
    publishProblems,
    optionInMaterial,
    type AdminCategory,
    type AdminMaterial,
    type AdminProduct,
    type AdminProductFile,
    type AdminProductImage,
    type Colour,
    type Material,
} from '@app/shared';
import { ArrowLeft, ArrowRight, Box, ExternalLink, ImageOff, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { data, Link, redirect, useFetcher } from 'react-router';
import { z } from 'zod';
import { cn } from 'cn';

import { confirmSubmit, Field, FormStatus, Select } from '~/components/admin/form';
import { LICENSE_GROUPS, licenseName } from '~/components/admin/licenses';
import { FeaturedBadge, StatusBadge } from '~/components/admin/product-status';
import { UploadButton } from '~/components/admin/upload-button';
import { ColourSwatch } from '~/components/colour-swatch';
import { LazyModelViewer } from '~/components/catalog/lazy-model-viewer';
import { Badge } from '~/components/ui/badge';
import { Button, buttonVariants } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import {
    centsToEuros,
    COLOUR_OPTION_PREFIX,
    fieldErrors,
    fileOfferOf,
    formValue,
    parseProductForm,
    PRINT_MATERIAL_PREFIX,
    printPriceField,
    reorderImages,
    type ImageMove,
} from '~/lib/admin-forms';
import { adminApi, invalid, noContent, runAction, type ActionResult } from '~/lib/admin.server';
import { formatBytes } from '~/lib/format';
import { PARCEL_SIZE_LABELS } from '~/lib/parcel-sizes';

import type { Route } from './+types/product-edit';

export const meta: Route.MetaFunction = ({ loaderData }) => [
    { title: `${loaderData?.product.title ?? 'Product'} – Admin – Pesoprint` },
    { name: 'robots', content: 'noindex' },
];

export async function loader(args: Route.LoaderArgs) {
    // Product ids are UUIDs; anything else can't exist (the API would call it a bad request).
    if (!z.uuid().safeParse(args.params.id).success) {
        throw data('Product not found', { status: 404 });
    }
    const [product, { categories }, { materials }, { colours }] = await Promise.all([
        adminApi(args, `/api/admin/products/${encodeURIComponent(args.params.id)}`, adminProductSchema),
        adminApi(args, '/api/admin/categories', adminCategoryListSchema),
        adminApi(args, '/api/admin/materials', adminMaterialListSchema),
        adminApi(args, '/api/admin/colours', adminColourListSchema),
    ]);
    return { product, categories, materials, colours };
}

export async function action(args: Route.ActionArgs) {
    const form = await args.request.formData();
    const intent = formValue(form, 'intent');
    const base = `/api/admin/products/${encodeURIComponent(args.params.id)}`;
    const imagePath = `${base}/images/${encodeURIComponent(formValue(form, 'imageId'))}`;
    const post = (path: string, message: string, method = 'POST') =>
        runAction(async () => {
            await adminApi(args, path, adminProductSchema, { method });
            return message;
        });

    switch (intent) {
        case 'save': {
            const parsed = parseProductForm(form);
            if (!parsed.ok) return invalid(parsed.issues);
            return runAction(async () => {
                await adminApi(args, base, adminProductSchema, { method: 'PATCH', json: parsed.data });
                return 'Saved.';
            });
        }
        case 'publish':
            return post(`${base}/publish`, 'Published. It is now on the site.');
        case 'archive':
            return post(`${base}/archive`, 'Archived. It is no longer on the site.');
        case 'feature':
            return post(`${base}/featured`, 'Featured on the home page.', 'PUT');
        case 'unfeature':
            return post(`${base}/featured`, 'No longer featured.', 'DELETE');
        case 'delete': {
            const result = await runAction(async () => {
                await adminApi(args, base, noContent, { method: 'DELETE' });
                return undefined;
            });
            return result.ok ? redirect('/admin/products') : result;
        }
        case 'image-alt':
            return runAction(async () => {
                await adminApi(args, imagePath, adminProductImageSchema, {
                    method: 'PATCH',
                    json: { alt: formValue(form, 'alt') },
                });
                return 'Saved.';
            });
        case 'image-move':
            return runAction(async () => {
                const product = await adminApi(args, base, adminProductSchema);
                const changes = reorderImages(
                    product.images,
                    formValue(form, 'imageId'),
                    formValue(form, 'move') as ImageMove,
                );
                for (const change of changes) {
                    await adminApi(args, `${base}/images/${change.id}`, adminProductImageSchema, {
                        method: 'PATCH',
                        json: { position: change.position },
                    });
                }
                return undefined;
            });
        case 'image-delete':
            return runAction(async () => {
                await adminApi(args, imagePath, noContent, { method: 'DELETE' });
                return undefined;
            });
        case 'preview-generate':
            return runAction(async () => {
                await adminApi(args, `${base}/preview`, adminProductFileSchema, { method: 'POST' });
                return 'Preview made from the STL.';
            });
        case 'file-delete':
            return runAction(async () => {
                const fileId = encodeURIComponent(formValue(form, 'fileId'));
                await adminApi(args, `${base}/files/${fileId}`, noContent, { method: 'DELETE' });
                return undefined;
            });
        default:
            throw data('Unknown action', { status: 400 });
    }
}

export default function EditProduct({ loaderData }: Route.ComponentProps) {
    const { product, categories, materials, colours } = loaderData;

    return (
        <main className='flex flex-col gap-6'>
            <div className='flex flex-wrap items-start justify-between gap-4'>
                <div className='space-y-2'>
                    <Link to='/admin/products' className='text-sm text-muted-foreground hover:text-foreground'>
                        ← Products
                    </Link>
                    <h1 className='text-3xl font-bold tracking-tight'>{product.title}</h1>
                    <div className='flex flex-wrap gap-1'>
                        <StatusBadge status={product.status} />
                        {product.featuredAt && <FeaturedBadge />}
                    </div>
                </div>
                {product.status === 'published' && (
                    <Button asChild variant='outline'>
                        <Link to={`/models/${product.slug}`}>
                            View on site
                            <ExternalLink aria-hidden />
                        </Link>
                    </Button>
                )}
            </div>

            <div className='grid items-start gap-8 lg:grid-cols-[1fr_20rem]'>
                <div className='flex min-w-0 flex-col gap-10'>
                    <DetailsForm product={product} categories={categories} materials={materials} colours={colours} />
                    <Images product={product} />
                    <Files product={product} />
                </div>
                <PublishPanel product={product} />
            </div>
        </main>
    );
}

// ---------------------------------------------------------------------------
// Details

const DETAIL_FIELDS = [
    'title',
    'slug',
    'categoryId',
    'description',
    'digitalPriceCents',
    'printOptions',
    'colourOptions',
    'parcelSize',
    'license',
    'sizeXMm',
    'sizeYMm',
    'sizeZMm',
    'printWeightG',
];

function categoryOptions(categories: AdminCategory[]) {
    return categories
        .filter((category) => category.parentId === null)
        .flatMap((parent) => [
            { id: parent.id, label: parent.name },
            ...categories
                .filter((child) => child.parentId === parent.id)
                .map((child) => ({ id: child.id, label: `${parent.name} › ${child.name}` })),
        ]);
}

function DetailsForm({
    product,
    categories,
    materials,
    colours,
}: {
    product: AdminProduct;
    categories: AdminCategory[];
    materials: AdminMaterial[];
    colours: Colour[];
}) {
    const fetcher = useFetcher<ActionResult>({ key: `product-details-${product.id}` });
    const result = fetcher.data;
    const errors = result && !result.ok ? fieldErrors(result.issues) : {};
    const slugLocked = product.publishedAt !== null;
    const fileOffer = fileOfferOf(product.digitalPriceCents);

    return (
        <section aria-labelledby='details-heading' className='grid gap-4'>
            <h2 id='details-heading' className='text-xl font-semibold'>
                Details
            </h2>
            <fetcher.Form method='post' className='grid gap-6' noValidate>
                <div className='grid gap-4 sm:grid-cols-2'>
                    <Field label='Title' name='title' error={errors.title}>
                        {(control) => <Input {...control} defaultValue={product.title} required maxLength={200} />}
                    </Field>
                    <Field
                        label='Slug'
                        name='slug'
                        error={errors.slug}
                        hint={
                            slugLocked
                                ? 'Fixed: the product has been published, and links to it would break.'
                                : 'The page address, /models/<slug>. It is fixed once published.'
                        }
                    >
                        {(control) => (
                            <Input
                                {...control}
                                defaultValue={product.slug}
                                readOnly={slugLocked}
                                required
                                maxLength={100}
                                className='font-mono read-only:bg-muted read-only:text-muted-foreground'
                            />
                        )}
                    </Field>
                    <Field label='Category' name='categoryId' error={errors.categoryId}>
                        {(control) => (
                            <Select {...control} defaultValue={product.categoryId ?? ''}>
                                <option value=''>None</option>
                                {categoryOptions(categories).map((option) => (
                                    <option key={option.id} value={option.id}>
                                        {option.label}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </Field>
                    <Field
                        label='Licence'
                        name='license'
                        error={errors.license}
                        hint='Needed when the file is offered. Paid files use a shop licence.'
                    >
                        {(control) => (
                            <Select {...control} defaultValue={product.license ?? ''}>
                                <option value=''>None</option>
                                {LICENSE_GROUPS.map((group) => (
                                    <optgroup key={group.label} label={group.label}>
                                        {group.ids.map((id) => (
                                            <option key={id} value={id}>
                                                {licenseName(id)}
                                            </option>
                                        ))}
                                    </optgroup>
                                ))}
                            </Select>
                        )}
                    </Field>
                    <Field
                        label='Description'
                        name='description'
                        error={errors.description}
                        hint='Markdown: **bold**, lists, [links](https://…). HTML is not shown.'
                        className='sm:col-span-2'
                    >
                        {(control) => (
                            <Textarea
                                {...control}
                                defaultValue={product.description}
                                rows={10}
                                maxLength={20000}
                                className='font-mono text-sm'
                            />
                        )}
                    </Field>
                </div>

                <div className='grid gap-6 sm:grid-cols-2'>
                    <fieldset className='grid content-start gap-3 rounded-lg border p-4'>
                        <legend className='px-1 text-sm font-medium'>Model file</legend>
                        <RadioOption name='fileOffer' value='none' defaultChecked={fileOffer === 'none'}>
                            Not offered
                        </RadioOption>
                        <RadioOption name='fileOffer' value='free' defaultChecked={fileOffer === 'free'}>
                            Free download
                        </RadioOption>
                        <RadioOption name='fileOffer' value='paid' defaultChecked={fileOffer === 'paid'}>
                            Paid
                        </RadioOption>
                        <Field
                            label='Price of the file (€, incl. VAT)'
                            name='digitalPrice'
                            error={errors.digitalPriceCents}
                            hint='Only used when the file is paid.'
                        >
                            {(control) => (
                                <Input
                                    {...control}
                                    inputMode='decimal'
                                    defaultValue={fileOffer === 'paid' ? centsToEuros(product.digitalPriceCents) : ''}
                                    placeholder='4.50'
                                />
                            )}
                        </Field>
                    </fieldset>

                    <PrintFieldset product={product} materials={materials} errors={errors} />
                </div>

                <ColourOptionsFieldset product={product} materials={materials} colours={colours} errors={errors} />

                <fieldset className='grid gap-4 rounded-lg border p-4 sm:grid-cols-4'>
                    <legend className='px-1 text-sm font-medium'>Printed size</legend>
                    {(
                        [
                            ['sizeXMm', 'Width (mm)', product.sizeXMm],
                            ['sizeYMm', 'Depth (mm)', product.sizeYMm],
                            ['sizeZMm', 'Height (mm)', product.sizeZMm],
                            ['printWeightG', 'Filament (g)', product.printWeightG],
                        ] as const
                    ).map(([name, label, value]) => (
                        <Field key={name} label={label} name={name} error={errors[name]}>
                            {(control) => (
                                <Input {...control} type='number' min={1} step={1} defaultValue={value ?? ''} />
                            )}
                        </Field>
                    ))}
                </fieldset>

                <div className='flex flex-wrap items-center gap-3'>
                    <Button type='submit' name='intent' value='save' disabled={fetcher.state !== 'idle'}>
                        {fetcher.state === 'idle' ? 'Save details' : 'Saving…'}
                    </Button>
                    <FormStatus
                        result={result}
                        fields={Object.keys(errors).filter(
                            (path) =>
                                DETAIL_FIELDS.includes(path) ||
                                path.startsWith('printPrice:') ||
                                path.startsWith(COLOUR_OPTION_PREFIX),
                        )}
                    />
                </div>
            </fetcher.Form>
        </section>
    );
}

/** Which materials the model can be printed in, its price in each, and the parcel it ships in. */
function PrintFieldset({
    product,
    materials,
    errors,
}: {
    product: AdminProduct;
    materials: Material[];
    errors: Record<string, string>;
}) {
    const prices = new Map(product.printOptions.map((option) => [option.materialId, option.priceCents]));

    return (
        <fieldset className='grid content-start gap-3 rounded-lg border p-4'>
            <legend className='px-1 text-sm font-medium'>Print</legend>
            {materials.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                    No materials yet.{' '}
                    <Link to='/admin/materials' className='text-primary underline-offset-4 hover:underline'>
                        Add them under Materials
                    </Link>{' '}
                    to offer prints.
                </p>
            ) : (
                <>
                    <p className='text-sm text-muted-foreground'>
                        Tick the materials it can be printed in, and set the price of a print in each (€, incl. VAT).
                        Leave all unticked to not offer prints.
                    </p>
                    <ul className='grid gap-2'>
                        {materials.map((material) => (
                            <PrintMaterialRow
                                key={material.id}
                                material={material}
                                priceCents={prices.get(material.id) ?? null}
                                error={errors[printPriceField(material.id)]}
                            />
                        ))}
                    </ul>
                    {errors.printOptions && <p className='text-sm text-destructive'>{errors.printOptions}</p>}
                </>
            )}
            <Field
                label='Parcel size'
                name='parcelSize'
                error={errors.parcelSize}
                hint={
                    product.parcelSize
                        ? PARCEL_SIZE_LABELS[product.parcelSize].hint
                        : 'Needed to publish a model that can be printed. Shipping is priced by it.'
                }
            >
                {(control) => (
                    <Select {...control} defaultValue={product.parcelSize ?? ''}>
                        <option value=''>Not set</option>
                        {PARCEL_SIZES.map((size) => (
                            <option key={size} value={size}>
                                {PARCEL_SIZE_LABELS[size].name} ({size})
                            </option>
                        ))}
                    </Select>
                )}
            </Field>
        </fieldset>
    );
}

/**
 * The colours buyers can choose a print in. Each row is one option: a single colour, or up to four for a
 * multicolour print, in order. None: the print comes in the colours shown in the photos.
 */
function ColourOptionsFieldset({
    product,
    materials,
    colours,
    errors,
}: {
    product: AdminProduct;
    materials: AdminMaterial[];
    colours: Colour[];
    errors: Record<string, string>;
}) {
    // The model's saved materials: each row says which of them can print it.
    const printedIn = materials.filter((material) =>
        product.printOptions.some((option) => option.materialId === material.id),
    );
    // One empty row to add an option; with JavaScript, "Add an option" adds more.
    const [rows, setRows] = useState(product.colourOptions.length + 1);

    return (
        <fieldset className='grid content-start gap-3 rounded-lg border p-4'>
            <legend className='px-1 text-sm font-medium'>Colour options</legend>
            {colours.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                    No colours yet.{' '}
                    <Link to='/admin/materials' className='text-primary underline-offset-4 hover:underline'>
                        Add them under Materials &amp; colours
                    </Link>{' '}
                    to let buyers choose one.
                </p>
            ) : (
                <>
                    <p className='text-sm text-muted-foreground'>
                        The colours buyers choose from, whatever the material. Pick one colour per row, or several for a
                        multicolour print (in order, e.g. body then details). Leave every row empty to print in the
                        colours shown in the photos: buyers then only choose the material.
                    </p>
                    <ul className='grid gap-2'>
                        {Array.from({ length: rows }, (_, row) => (
                            <ColourOptionRow
                                key={row}
                                row={row}
                                colours={colours}
                                materials={printedIn}
                                colourIds={product.colourOptions[row]?.colourIds ?? []}
                                error={errors[`${COLOUR_OPTION_PREFIX}${row}`]}
                            />
                        ))}
                    </ul>
                    <div>
                        <Button type='button' variant='outline' size='sm' onClick={() => setRows(rows + 1)}>
                            <Plus aria-hidden />
                            Add an option
                        </Button>
                    </div>
                    {errors.colourOptions && <p className='text-sm text-destructive'>{errors.colourOptions}</p>}
                </>
            )}
        </fieldset>
    );
}

/** Which of the model's materials can print these colours, for the line under an option. */
function printableIn(picked: Colour[], materials: AdminMaterial[]): string {
    const option = { colourIds: picked.map((colour) => colour.id) };
    const fits = materials.flatMap((material) => {
        const fit = optionInMaterial(option, material);
        return fit ? [fit.inStock ? material.name : `${material.name} (out of stock)`] : [];
    });
    return fits.length > 0
        ? `In ${fits.join(', ')}.`
        : "None of this model's materials comes in these colours, so buyers won't see it.";
}

function ColourOptionRow({
    row,
    colours,
    materials,
    colourIds,
    error,
}: {
    row: number;
    colours: Colour[];
    materials: AdminMaterial[];
    colourIds: string[];
    error: string | undefined;
}) {
    // The menus' values, empty ones included, for the preview next to them.
    const [chosen, setChosen] = useState(() =>
        Array.from({ length: MAX_OPTION_COLOURS }, (_, slot) => colourIds[slot] ?? ''),
    );
    const picked = chosen
        .map((id) => colours.find((colour) => colour.id === id))
        .filter((colour): colour is Colour => colour !== undefined);
    const name = `${COLOUR_OPTION_PREFIX}${row}`;
    const errorId = `colour-option-${row}-error`;

    return (
        <li className='grid gap-1'>
            <div className='flex flex-wrap items-center gap-2'>
                <span className='w-6 text-sm text-muted-foreground tabular-nums'>{row + 1}.</span>
                {Array.from({ length: MAX_OPTION_COLOURS }, (_, slot) => (
                    <Select
                        key={slot}
                        name={name}
                        aria-label={`Option ${row + 1}, colour ${slot + 1}`}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        defaultValue={colourIds[slot] ?? ''}
                        onChange={(event) => {
                            const next = [...chosen];
                            next[slot] = event.currentTarget.value;
                            setChosen(next);
                        }}
                        className='h-8 w-36'
                    >
                        <option value=''>{slot === 0 ? 'None' : '—'}</option>
                        {colours.map((colour) => (
                            <option key={colour.id} value={colour.id}>
                                {colour.name}
                            </option>
                        ))}
                    </Select>
                ))}
                {picked.length > 0 && (
                    <span className='flex items-center gap-1.5 text-sm'>
                        <ColourSwatch colours={picked} />
                        {colourOptionName(picked)}
                    </span>
                )}
            </div>
            {picked.length > 0 && materials.length > 0 && (
                <p className='pl-8 text-xs text-muted-foreground'>{printableIn(picked, materials)}</p>
            )}
            {error && (
                <p id={errorId} className='text-sm text-destructive'>
                    {error}
                </p>
            )}
        </li>
    );
}

function PrintMaterialRow({
    material,
    priceCents,
    error,
}: {
    material: Material;
    priceCents: number | null;
    error: string | undefined;
}) {
    const priceId = `print-price-${material.id}`;
    const errorId = `${priceId}-error`;

    return (
        <li className='grid gap-1'>
            <div className='flex items-center gap-3'>
                <label className='flex min-w-0 flex-1 items-center gap-2 text-sm'>
                    <input
                        type='checkbox'
                        name={`${PRINT_MATERIAL_PREFIX}${material.id}`}
                        defaultChecked={priceCents !== null}
                        className='size-4 accent-primary'
                    />
                    <span className='truncate font-medium'>{material.name}</span>
                    {!material.active && <Badge variant='secondary'>Inactive</Badge>}
                </label>
                <label htmlFor={priceId} className='sr-only'>
                    Price of a print in {material.name} (€)
                </label>
                <Input
                    id={priceId}
                    name={printPriceField(material.id)}
                    inputMode='decimal'
                    defaultValue={centsToEuros(priceCents)}
                    placeholder='12.90'
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    className='w-24'
                />
            </div>
            {error && (
                <p id={errorId} className='text-sm text-destructive'>
                    {error}
                </p>
            )}
        </li>
    );
}

function RadioOption({
    name,
    value,
    defaultChecked,
    children,
}: {
    name: string;
    value: string;
    defaultChecked: boolean;
    children: React.ReactNode;
}) {
    return (
        <label className='flex items-center gap-2 text-sm'>
            <input
                type='radio'
                name={name}
                value={value}
                defaultChecked={defaultChecked}
                className='size-4 accent-primary'
            />
            {children}
        </label>
    );
}

// ---------------------------------------------------------------------------
// Images

function Images({ product }: { product: AdminProduct }) {
    return (
        <section aria-labelledby='images-heading' className='grid gap-4'>
            <div className='flex flex-wrap items-center justify-between gap-4'>
                <div>
                    <h2 id='images-heading' className='text-xl font-semibold'>
                        Images
                    </h2>
                    <p className='text-sm text-muted-foreground'>
                        The first image is the cover. JPEG, PNG, WebP or AVIF, up to 10 MB.
                    </p>
                </div>
                <UploadButton
                    productId={product.id}
                    target='image'
                    label='Add images'
                    multiple
                    alt={() => `Photo of the ${product.title}`}
                />
            </div>
            {product.images.length === 0 ? (
                <p className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
                    No images yet. A product needs at least one to be published.
                </p>
            ) : (
                <ol className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
                    {product.images.map((image, index) => (
                        <ImageItem key={image.id} image={image} index={index} count={product.images.length} />
                    ))}
                </ol>
            )}
        </section>
    );
}

function ImageItem({ image, index, count }: { image: AdminProductImage; index: number; count: number }) {
    const fetcher = useFetcher<ActionResult>();
    const busy = fetcher.state !== 'idle';
    const result = fetcher.data;
    const errors = result && !result.ok ? fieldErrors(result.issues) : {};
    const position = `image ${index + 1} of ${count}`;

    return (
        <li className='flex flex-col overflow-hidden rounded-lg border'>
            {/* A fixed 4:3 frame: the whole photo fits inside, whatever its shape, so every card lines up. */}
            <div className='relative aspect-[4/3] overflow-hidden bg-muted'>
                {image.url ? (
                    <img
                        src={image.url}
                        alt={image.alt}
                        width={image.width}
                        height={image.height}
                        loading='lazy'
                        className='absolute inset-0 size-full object-contain'
                    />
                ) : (
                    <div className='absolute inset-0 flex items-center justify-center text-muted-foreground'>
                        <ImageOff aria-hidden />
                        <span className='sr-only'>No preview: file storage is not configured</span>
                    </div>
                )}
                {index === 0 && <Badge className='absolute top-2 left-2'>Cover</Badge>}
            </div>

            <div className='flex items-center justify-between gap-1 border-b px-2 py-1'>
                <fetcher.Form method='post' className='flex items-center gap-1'>
                    <input type='hidden' name='imageId' value={image.id} />
                    <input type='hidden' name='intent' value='image-move' />
                    <Button
                        type='submit'
                        name='move'
                        value='earlier'
                        size='icon'
                        variant='ghost'
                        disabled={busy || index === 0}
                        aria-label={`Move ${position} earlier`}
                        title='Move earlier'
                    >
                        <ArrowLeft aria-hidden />
                    </Button>
                    <Button
                        type='submit'
                        name='move'
                        value='later'
                        size='icon'
                        variant='ghost'
                        disabled={busy || index === count - 1}
                        aria-label={`Move ${position} later`}
                        title='Move later'
                    >
                        <ArrowRight aria-hidden />
                    </Button>
                    {index > 0 && (
                        <Button
                            type='submit'
                            name='move'
                            value='first'
                            size='sm'
                            variant='ghost'
                            disabled={busy}
                            aria-label={`Make ${position} the cover`}
                        >
                            <Star aria-hidden />
                            Make cover
                        </Button>
                    )}
                </fetcher.Form>
                <fetcher.Form method='post' onSubmit={confirmSubmit('Delete this image?')}>
                    <input type='hidden' name='imageId' value={image.id} />
                    <Button
                        type='submit'
                        name='intent'
                        value='image-delete'
                        size='icon'
                        variant='ghost'
                        className='text-destructive hover:text-destructive'
                        disabled={busy}
                        aria-label={`Delete ${position}`}
                        title='Delete'
                    >
                        <Trash2 aria-hidden />
                    </Button>
                </fetcher.Form>
            </div>

            <fetcher.Form method='post' className='grid gap-2 p-3'>
                <input type='hidden' name='imageId' value={image.id} />
                <Field label='Alt text' name='alt' error={errors.alt} hint='What the image shows, for screen readers.'>
                    {(control) => (
                        <div className='flex gap-2'>
                            <Input {...control} defaultValue={image.alt} required maxLength={300} />
                            <Button type='submit' name='intent' value='image-alt' variant='outline' disabled={busy}>
                                Save
                            </Button>
                        </div>
                    )}
                </Field>
                <FormStatus result={result} fields={Object.keys(errors)} />
            </fetcher.Form>
        </li>
    );
}

// ---------------------------------------------------------------------------
// Files

function Files({ product }: { product: AdminProduct }) {
    const downloads = product.files.filter((file) => file.kind === 'download');
    const preview = product.files.find((file) => file.kind === 'preview');
    const hasStl = downloads.some((file) => file.format === 'stl');

    return (
        <section aria-labelledby='files-heading' className='grid gap-6'>
            <h2 id='files-heading' className='text-xl font-semibold'>
                Files
            </h2>

            <div className='grid gap-3'>
                <div className='flex flex-wrap items-center justify-between gap-4'>
                    <div>
                        <h3 className='font-medium'>Downloads</h3>
                        <p className='text-sm text-muted-foreground'>
                            What people get when the file is offered. Private: only available through the shop.
                        </p>
                    </div>
                    <UploadButton productId={product.id} target='download' label='Add files' multiple />
                </div>
                {downloads.length === 0 ? (
                    <p className='rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
                        No files yet. STL, 3MF, STEP or OBJ, up to 1 GB.
                    </p>
                ) : (
                    <ul className='divide-y rounded-lg border'>
                        {downloads.map((file) => (
                            <FileItem
                                key={file.id}
                                file={file}
                                downloadHref={`/models/${product.slug}/download/${file.id}`}
                            />
                        ))}
                    </ul>
                )}
            </div>

            <div className='grid gap-3'>
                <div className='flex flex-wrap items-center justify-between gap-4'>
                    <div>
                        <h3 className='font-medium'>3D preview</h3>
                        <p className='text-sm text-muted-foreground'>
                            Shown in the public 3D viewer for free downloads only: paid and print-only models have no 3D
                            view, since it would give the model away. Made automatically from the first STL you upload,
                            or upload your own reduced .glb (up to 25 MB). Never the full-quality model.
                        </p>
                    </div>
                    <div className='flex flex-wrap items-start gap-2'>
                        {hasStl && <GeneratePreviewButton again={preview !== undefined} />}
                        <UploadButton productId={product.id} target='preview' label='Upload a .glb' />
                    </div>
                </div>
                {preview ? (
                    <div className='grid gap-2'>
                        <div className='relative aspect-[4/3] max-w-xl overflow-hidden rounded-lg border bg-muted'>
                            {preview.url ? (
                                <LazyModelViewer url={preview.url} title={product.title} />
                            ) : (
                                <p className='absolute inset-0 flex items-center justify-center text-sm text-muted-foreground'>
                                    No viewer: file storage is not configured.
                                </p>
                            )}
                        </div>
                        <ul className='max-w-xl rounded-lg border'>
                            <FileItem file={preview} />
                        </ul>
                    </div>
                ) : (
                    <p className='rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
                        No preview yet.{' '}
                        {hasStl ? 'Make one from the STL, or upload a .glb.' : 'Upload an STL to make one.'}
                    </p>
                )}
            </div>
        </section>
    );
}

/** Makes the preview from the product's first STL (again), on the server. */
function GeneratePreviewButton({ again }: { again: boolean }) {
    const fetcher = useFetcher<ActionResult>();
    const busy = fetcher.state !== 'idle';
    return (
        <fetcher.Form method='post' className='grid gap-2'>
            <Button type='submit' name='intent' value='preview-generate' variant='outline' size='sm' disabled={busy}>
                <Box aria-hidden />
                {busy ? 'Making the preview…' : again ? 'Remake from STL' : 'Make from STL'}
            </Button>
            <FormStatus result={fetcher.data} />
        </fetcher.Form>
    );
}

/** `downloadHref`: where an admin can download the file (downloads only; drafts and paid files too). */
function FileItem({ file, downloadHref }: { file: AdminProductFile; downloadHref?: string }) {
    const fetcher = useFetcher<ActionResult>();

    return (
        <li className='grid gap-2 px-4 py-3'>
            <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
                <span className='min-w-0 truncate font-medium'>{file.filename}</span>
                <span className='text-sm text-muted-foreground uppercase'>{file.format}</span>
                <span className='text-sm text-muted-foreground'>{formatBytes(file.sizeBytes)}</span>
                {downloadHref && (
                    <a
                        href={downloadHref}
                        className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'ml-auto')}
                        aria-label={`Download ${file.filename}`}
                    >
                        Download
                    </a>
                )}
                <fetcher.Form
                    method='post'
                    className={downloadHref ? undefined : 'ml-auto'}
                    onSubmit={confirmSubmit(`Delete ${file.filename}? The stored file is deleted too.`)}
                >
                    <input type='hidden' name='fileId' value={file.id} />
                    <Button
                        type='submit'
                        name='intent'
                        value='file-delete'
                        size='sm'
                        variant='ghost'
                        className='text-destructive'
                        disabled={fetcher.state !== 'idle'}
                        aria-label={`Delete ${file.filename}`}
                    >
                        Delete
                    </Button>
                </fetcher.Form>
            </div>
            <FormStatus result={fetcher.data} />
        </li>
    );
}

// ---------------------------------------------------------------------------
// Publishing

const dateFormat = new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium', timeZone: 'UTC' });

function PublishPanel({ product }: { product: AdminProduct }) {
    const fetcher = useFetcher<ActionResult>();
    const busy = fetcher.state !== 'idle';
    const problems = publishProblems({
        ...product,
        imageCount: product.images.length,
        downloadFileCount: product.files.filter((file) => file.kind === 'download').length,
    });
    // Published products are archived first, so nothing disappears from the site by one wrong click.

    return (
        <aside aria-labelledby='publishing-heading' className='grid gap-4 rounded-lg border p-4 lg:sticky lg:top-20'>
            <h2 id='publishing-heading' className='font-semibold'>
                Publishing
            </h2>

            {product.status === 'published' ? (
                <p className='text-sm text-muted-foreground'>
                    On the site since {dateFormat.format(new Date(product.publishedAt!))}.
                </p>
            ) : (
                <>
                    <p className='text-sm text-muted-foreground'>
                        {product.status === 'archived'
                            ? 'Archived: hidden from the site. Publish it again to bring it back.'
                            : 'A draft: only admins can see it.'}
                    </p>
                    {problems.length > 0 ? (
                        <div className='text-sm'>
                            <p className='font-medium'>Before it can be published:</p>
                            <ul className='mt-1 list-disc pl-5 text-muted-foreground'>
                                {problems.map((problem) => (
                                    <li key={problem.message}>{problem.message}</li>
                                ))}
                            </ul>
                            <p className='mt-2 text-xs text-muted-foreground'>Based on the saved details.</p>
                        </div>
                    ) : (
                        <p className='text-sm font-medium'>Ready to publish.</p>
                    )}
                </>
            )}

            <div className='flex flex-wrap gap-2'>
                {product.status !== 'published' && (
                    <fetcher.Form method='post'>
                        <Button type='submit' name='intent' value='publish' disabled={busy || problems.length > 0}>
                            Publish
                        </Button>
                    </fetcher.Form>
                )}
                {product.status !== 'archived' && (
                    <fetcher.Form method='post'>
                        <Button
                            type='submit'
                            name='intent'
                            value={product.featuredAt ? 'unfeature' : 'feature'}
                            variant='outline'
                            disabled={busy}
                        >
                            <Star aria-hidden className={product.featuredAt ? 'fill-current' : undefined} />
                            {product.featuredAt ? 'Stop featuring' : 'Feature'}
                        </Button>
                    </fetcher.Form>
                )}
                {product.status === 'published' && (
                    <fetcher.Form
                        method='post'
                        onSubmit={confirmSubmit(
                            'Archive this product? It disappears from the site until published again.',
                        )}
                    >
                        <Button type='submit' name='intent' value='archive' variant='outline' disabled={busy}>
                            Archive
                        </Button>
                    </fetcher.Form>
                )}
            </div>
            {product.status !== 'archived' && (
                <p className='text-xs text-muted-foreground'>
                    Featured products appear on the home page, most recently featured first
                    {product.status === 'draft' ? ', once published' : ''}.
                </p>
            )}

            <FormStatus result={fetcher.data} />

            {product.status === 'published' ? (
                <p className='border-t pt-4 text-xs text-muted-foreground'>To delete it, archive it first.</p>
            ) : (
                <fetcher.Form
                    method='post'
                    className='border-t pt-4'
                    onSubmit={confirmSubmit(
                        `Delete “${product.title}” with its images and files? This can't be undone.`,
                    )}
                >
                    <Button type='submit' name='intent' value='delete' variant='destructive' size='sm' disabled={busy}>
                        Delete product
                    </Button>
                </fetcher.Form>
            )}
        </aside>
    );
}
