import { isFreeDownload, isPaidFile, LICENSES, offersPrint, type CatalogProduct } from '@app/shared';
import { Download, FileBox, Printer } from 'lucide-react';

import { Breadcrumbs, type Crumb } from '~/components/catalog/breadcrumbs';
import { Markdown } from '~/components/catalog/markdown';
import { ProductGallery } from '~/components/catalog/product-gallery';
import { Button } from '~/components/ui/button';
import { getProduct } from '~/lib/catalog.server';
import { formatBytes, formatPrice, plainExcerpt } from '~/lib/format';
import { pageMeta } from '~/lib/seo';
import { absoluteUrl } from '~/lib/site.server';

import type { Route } from './+types/product';

export async function loader({ params }: Route.LoaderArgs) {
    const product = await getProduct(params.slug);
    return { product, url: absoluteUrl(`/models/${product.slug}`) };
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
    if (!loaderData) return [];
    const { product, url } = loaderData;
    return pageMeta({
        title: product.title,
        description: plainExcerpt(product.description) || `${product.title}: a 3D model to download or order printed.`,
        url,
        image: product.cover?.url,
        type: 'product',
    });
};

export default function Product({ loaderData }: Route.ComponentProps) {
    const { product } = loaderData;
    const crumbs: Crumb[] = [
        { label: 'Home', to: '/' },
        { label: 'Models', to: '/models' },
        ...(product.category?.parent
            ? [{ label: product.category.parent.name, to: `/categories/${product.category.parent.slug}` }]
            : []),
        ...(product.category ? [{ label: product.category.name, to: `/categories/${product.category.slug}` }] : []),
        { label: product.title },
    ];

    return (
        <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-10'>
            <Breadcrumbs items={crumbs} />

            <div className='grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
                <ProductGallery images={product.images} title={product.title} />

                <div className='flex flex-col gap-6'>
                    <h1 className='text-3xl font-bold tracking-tight'>{product.title}</h1>
                    <GetThisModel product={product} />
                    <Details product={product} />
                </div>
            </div>

            {product.description && (
                <section aria-labelledby='about-heading' className='max-w-3xl'>
                    <h2 id='about-heading' className='text-xl font-semibold'>
                        About this model
                    </h2>
                    <div className='mt-3'>
                        <Markdown>{product.description}</Markdown>
                    </div>
                </section>
            )}
        </main>
    );
}

/** The ways to get the model. Downloads, checkout and print orders arrive in M2–M4, so the buttons are disabled for now. */
function GetThisModel({ product }: { product: CatalogProduct }) {
    return (
        <section aria-labelledby='get-heading' className='flex flex-col gap-3 rounded-lg border p-5'>
            <h2 id='get-heading' className='text-sm font-medium text-muted-foreground'>
                Get this model
            </h2>
            {isFreeDownload(product) && (
                <Offer
                    icon={<Download aria-hidden />}
                    label='Free download'
                    action='Download'
                    note='Free downloads open soon.'
                />
            )}
            {isPaidFile(product) && (
                <Offer
                    icon={<FileBox aria-hidden />}
                    label={`Model file · ${formatPrice(product.digitalPriceCents!)}`}
                    action='Buy file'
                    note='Checkout opens soon.'
                />
            )}
            {offersPrint(product) && (
                <Offer
                    icon={<Printer aria-hidden />}
                    label={`Printed for you · from ${formatPrice(product.printBasePriceCents!)}`}
                    action='Order a print'
                    note='Print orders open soon. The final price depends on the material and colour.'
                />
            )}
            <p className='text-xs text-muted-foreground'>Prices include VAT.</p>
        </section>
    );
}

function Offer({ icon, label, action, note }: { icon: React.ReactNode; label: string; action: string; note: string }) {
    return (
        <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
                <p className='flex items-center gap-2 font-medium [&_svg]:size-4'>
                    {icon}
                    {label}
                </p>
                <p className='text-sm text-muted-foreground'>{note}</p>
            </div>
            <Button disabled>{action}</Button>
        </div>
    );
}

function Details({ product }: { product: CatalogProduct }) {
    const license = product.license ? LICENSES[product.license] : null;
    return (
        <dl className='grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm'>
            {product.size && (
                <>
                    <dt className='text-muted-foreground'>Printed size</dt>
                    <dd>
                        {product.size.x} × {product.size.y} × {product.size.z} mm
                    </dd>
                </>
            )}
            {product.printWeightG !== null && (
                <>
                    <dt className='text-muted-foreground'>Filament</dt>
                    <dd>about {product.printWeightG} g</dd>
                </>
            )}
            {license && (
                <>
                    <dt className='text-muted-foreground'>Licence</dt>
                    <dd>
                        {license.url ? (
                            <a
                                href={license.url}
                                className='underline underline-offset-4'
                                rel='license noopener noreferrer'
                            >
                                {license.name}
                            </a>
                        ) : (
                            license.name
                        )}
                    </dd>
                </>
            )}
            {product.files.length > 0 && (
                <>
                    <dt className='text-muted-foreground'>Files</dt>
                    <dd>
                        <ul>
                            {product.files.map((file) => (
                                <li key={file.filename}>
                                    {file.filename}{' '}
                                    <span className='text-muted-foreground'>
                                        ({file.format.toUpperCase()}, {formatBytes(file.sizeBytes)})
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </dd>
                </>
            )}
        </dl>
    );
}
