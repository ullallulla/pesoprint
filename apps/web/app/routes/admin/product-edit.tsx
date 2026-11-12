import {
    adminCategoryListSchema,
    adminProductFileSchema,
    adminProductImageSchema,
    adminProductSchema,
    publishProblems,
    type AdminCategory,
    type AdminProduct,
    type AdminProductFile,
    type AdminProductImage,
} from '@app/shared';
import { ArrowLeft, ArrowRight, Box, ExternalLink, ImageOff, Star, Trash2 } from 'lucide-react';
import { data, Link, redirect, useFetcher } from 'react-router';
import { z } from 'zod';

import { confirmSubmit, Field, FormStatus, Select } from '~/components/admin/form';
import { LICENSE_GROUPS, licenseName } from '~/components/admin/licenses';
import { FeaturedBadge, StatusBadge } from '~/components/admin/product-status';
import { UploadButton } from '~/components/admin/upload-button';
import { LazyModelViewer } from '~/components/catalog/lazy-model-viewer';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import {
    centsToEuros,
    fieldErrors,
    fileOfferOf,
    formValue,
    parseProductForm,
    reorderImages,
    type ImageMove,
} from '~/lib/admin-forms';
import { adminApi, invalid, noContent, runAction, type ActionResult } from '~/lib/admin.server';
import { formatBytes } from '~/lib/format';

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
    const [product, { categories }] = await Promise.all([
        adminApi(args, `/api/admin/products/${encodeURIComponent(args.params.id)}`, adminProductSchema),
        adminApi(args, '/api/admin/categories', adminCategoryListSchema),
    ]);
    return { product, categories };
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
    const { product, categories } = loaderData;

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
                    <DetailsForm product={product} categories={categories} />
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
    'printBasePriceCents',
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

function DetailsForm({ product, categories }: { product: AdminProduct; categories: AdminCategory[] }) {
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

                    <fieldset className='grid content-start gap-3 rounded-lg border p-4'>
                        <legend className='px-1 text-sm font-medium'>Print</legend>
                        <label className='flex items-center gap-2 text-sm'>
                            <input
                                type='checkbox'
                                name='offerPrint'
                                defaultChecked={product.printBasePriceCents !== null}
                                className='size-4 accent-primary'
                            />
                            Offer printed copies
                        </label>
                        <Field
                            label='Starting price (€, incl. VAT)'
                            name='printPrice'
                            error={errors.printBasePriceCents}
                            hint='The price in the default material and colour.'
                        >
                            {(control) => (
                                <Input
                                    {...control}
                                    inputMode='decimal'
                                    defaultValue={centsToEuros(product.printBasePriceCents)}
                                    placeholder='12.90'
                                />
                            )}
                        </Field>
                    </fieldset>
                </div>

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
                    <FormStatus result={result} fields={DETAIL_FIELDS.filter((path) => errors[path])} />
                </div>
            </fetcher.Form>
        </section>
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
                            <FileItem key={file.id} file={file} />
                        ))}
                    </ul>
                )}
            </div>

            <div className='grid gap-3'>
                <div className='flex flex-wrap items-center justify-between gap-4'>
                    <div>
                        <h3 className='font-medium'>3D preview</h3>
                        <p className='text-sm text-muted-foreground'>
                            Shown in the public 3D viewer. Made automatically from the first STL you upload, or upload
                            your own reduced .glb (up to 25 MB). Never the full-quality model.
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

function FileItem({ file }: { file: AdminProductFile }) {
    const fetcher = useFetcher<ActionResult>();

    return (
        <li className='grid gap-2 px-4 py-3'>
            <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
                <span className='min-w-0 truncate font-medium'>{file.filename}</span>
                <span className='text-sm text-muted-foreground uppercase'>{file.format}</span>
                <span className='text-sm text-muted-foreground'>{formatBytes(file.sizeBytes)}</span>
                <fetcher.Form
                    method='post'
                    className='ml-auto'
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
