import {
    INTERIM_SHIPPING_CENTS,
    isFreeDownload,
    isPaidFile,
    LICENSES,
    MAX_PRINT_QUANTITY,
    offersPrint,
    PARCEL_SIZE_NAMES,
    printCartItemSchema,
    reviewInputSchema,
    type CatalogProduct,
    type LibraryItem,
} from '@app/shared';
import { getAuth } from '@clerk/react-router/server';
import { cn } from 'cn';
import { Check, Download, FileBox, Library, Printer, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { data, Link, redirect, useFetcher } from 'react-router';

import { Breadcrumbs, type Crumb } from '~/components/catalog/breadcrumbs';
import { ColourSwatch } from '~/components/colour-swatch';
import { FavouriteButton } from '~/components/favourite-button';
import { Markdown } from '~/components/catalog/markdown';
import { ProductGallery } from '~/components/catalog/product-gallery';
import { FileDownloads, type DownloadableFile } from '~/components/file-downloads';
import { RatingLine } from '~/components/rating-stars';
import { ReviewsSection } from '~/components/reviews';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { track } from '~/lib/analytics';
import { ApiRequestError } from '~/lib/api.server';
import { addToCart, cartChanged, isInCart, readCart } from '~/lib/cart.server';
import { getProduct } from '~/lib/catalog.server';
import { isFavourite, setFavourite } from '~/lib/favourites.server';
import { formatBytes, formatPrice, plainExcerpt } from '~/lib/format';
import { getOwned } from '~/lib/library.server';
import { deleteReview, getMyReview, getReviews, saveReview } from '~/lib/reviews.server';
import { pageMeta } from '~/lib/seo';
import { absoluteUrl } from '~/lib/site.server';

import type { Route } from './+types/product';

/** `?reviews=2`: which page of reviews is shown. Anything else is the first. */
function reviewPageOf(url: URL): number {
    const page = Number(url.searchParams.get('reviews'));
    return Number.isInteger(page) && page > 1 ? page : 1;
}

export async function loader(args: Route.LoaderArgs) {
    const [product, cart] = await Promise.all([getProduct(args.params.slug), readCart(args.request)]);
    const [owned, reviews, myReview, favourite] = await Promise.all([
        // A free file is anyone's anyway. Otherwise a buyer gets their files here, whatever the model costs now.
        isFreeDownload(product) ? null : getOwned(args, product.id),
        getReviews(product.slug, reviewPageOf(new URL(args.request.url))),
        getMyReview(args, product.id),
        isFavourite(args, product.id),
    ]);
    return {
        product,
        url: absoluteUrl(`/models/${product.slug}`),
        inCart: isInCart(cart, { productId: product.id, type: 'digital' }),
        printsInCart: cart.reduce(
            (sum, item) => sum + (item.type === 'print' && item.productId === product.id ? item.quantity : 0),
            0,
        ),
        owned,
        reviews,
        myReview,
        favourite,
    };
}

const ACCOUNT_INTENTS = ['save-review', 'delete-review', 'favourite'] as const;
type AccountIntent = (typeof ACCOUNT_INTENTS)[number];
const isAccountIntent = (intent: unknown): intent is AccountIntent =>
    (ACCOUNT_INTENTS as readonly unknown[]).includes(intent);

/**
 * Reviewing and saving the model, for signed-in visitors. The API decides who may review: a refusal comes back
 * as the form's error. Without JavaScript the page reloads at the reviews.
 */
async function accountAction(args: Route.ActionArgs, product: CatalogProduct, intent: AccountIntent, form: FormData) {
    const { isAuthenticated, getToken } = await getAuth(args);
    if (!isAuthenticated) return { error: 'Sign in first.' };
    const token = await getToken();
    try {
        if (intent === 'favourite') {
            await setFavourite(token, product.id, form.get('save') === 'true');
        } else if (intent === 'delete-review') {
            await deleteReview(token, product.id);
        } else {
            const body = form.get('body');
            const parsed = reviewInputSchema.safeParse({
                rating: Number(form.get('rating')),
                body: typeof body === 'string' ? body : '',
            });
            if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check your review.' };
            await saveReview(token, product.id, parsed.data);
        }
    } catch (error) {
        if (error instanceof ApiRequestError && [400, 403, 404, 409].includes(error.status)) {
            return { error: error.message };
        }
        throw error;
    }
    const page = `/models/${product.slug}${intent === 'favourite' ? '' : '#reviews'}`;
    return args.request.headers.get('sec-fetch-mode') === 'navigate' ? redirect(page) : { error: null };
}

/**
 * "Add to cart" (the file) and "Add to cart" (a print) post here, and so do reviews and the heart. Works without
 * JavaScript too: the page then reloads, showing what's in the cart.
 */
export async function action(args: Route.ActionArgs) {
    const { params, request } = args;
    const form = await request.formData();
    const intent = form.get('intent');
    // The product comes from the page's own slug, so only this page's model can be added, and only if it's sold.
    const product = await getProduct(params.slug);
    if (isAccountIntent(intent)) return accountAction(args, product, intent, form);

    let item;
    if (intent === 'add-to-cart') {
        if (!isPaidFile(product)) throw data("This model's file isn't for sale.", { status: 400 });
        item = { productId: product.id, type: 'digital' as const };
    } else if (intent === 'add-print') {
        const materialId = form.get('materialId');
        if (!product.printOptions.some((option) => option.materialId === materialId)) {
            return { error: 'Choose a material.' };
        }
        // A model without colour options is printed in the colours shown: there's nothing to choose.
        const colourOptionId = product.colourOptions.length === 0 ? null : form.get('colourOptionId');
        if (colourOptionId !== null && !colourInStock(product, colourOptionId, materialId)) {
            return { error: 'Choose a colour that is in stock in this material.' };
        }
        const parsed = printCartItemSchema.safeParse({
            productId: product.id,
            type: 'print',
            materialId,
            colourOptionId,
            quantity: Number(form.get('quantity')),
        });
        if (!parsed.success) return { error: `Choose between 1 and ${MAX_PRINT_QUANTITY} copies.` };
        item = parsed.data;
    } else {
        throw data('Unknown action', { status: 400 });
    }

    const added = addToCart(await readCart(request), item);
    if (!added.ok) return { error: added.error };
    return cartChanged(request, added.items, `/models/${product.slug}`);
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
    const { product, inCart, printsInCart, owned, reviews, myReview, favourite } = loaderData;
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
                <ProductGallery images={product.images} title={product.title} preview={product.preview} />

                <div className='flex flex-col gap-6'>
                    <div className='flex items-start justify-between gap-4'>
                        <div className='flex flex-col gap-2'>
                            <h1 className='text-3xl font-bold tracking-tight'>{product.title}</h1>
                            {product.rating && (
                                <a href='#reviews' className='self-start rounded-sm hover:underline'>
                                    <RatingLine rating={product.rating} />
                                </a>
                            )}
                        </div>
                        <FavouriteButton saved={favourite} className='shrink-0' />
                    </div>
                    <GetThisModel product={product} inCart={inCart} printsInCart={printsInCart} owned={owned} />
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

            <ReviewsSection
                rating={product.rating}
                page={reviews}
                mine={myReview}
                href={(page) => `/models/${product.slug}${page > 1 ? `?reviews=${page}` : ''}#reviews`}
            />
        </main>
    );
}

/** The ways to get the model: download it, buy the file, or order a print. */
function GetThisModel({
    product,
    inCart,
    printsInCart,
    owned,
}: {
    product: CatalogProduct;
    inCart: boolean;
    printsInCart: number;
    owned: LibraryItem | null;
}) {
    return (
        <section aria-labelledby='get-heading' className='flex flex-col gap-3 rounded-lg border p-5'>
            <h2 id='get-heading' className='text-sm font-medium text-muted-foreground'>
                Get this model
            </h2>
            {isFreeDownload(product) && <FreeDownload product={product} />}
            {owned ? (
                <OwnedFile product={product} owned={owned} />
            ) : (
                isPaidFile(product) && <BuyFile product={product} inCart={inCart} />
            )}
            {offersPrint(product) && product.printOptions.length > 0 && (
                <OrderPrint product={product} inCart={printsInCart} />
            )}
            <p className='text-xs text-muted-foreground'>Prices include VAT.</p>
        </section>
    );
}

/** Adds the file to the cart without leaving the page; once it's there, links to the cart instead. */
function BuyFile({ product, inCart }: { product: CatalogProduct; inCart: boolean }) {
    const fetcher = useFetcher<typeof action>();
    // Shown as added as soon as it's sent; the loader confirms it a moment later.
    const added = inCart || (fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'add-to-cart');
    const error = fetcher.state === 'idle' ? fetcher.data?.error : null;

    return (
        <div className='flex flex-col gap-2'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
                <div>
                    <p className='flex items-center gap-2 font-medium [&_svg]:size-4'>
                        <FileBox aria-hidden />
                        Model file · {formatPrice(product.digitalPriceCents!)}
                    </p>
                    <p className='text-sm text-muted-foreground'>
                        {added ? (
                            <span className='inline-flex items-center gap-1'>
                                <Check className='size-4' aria-hidden />
                                In your cart
                            </span>
                        ) : (
                            'Download it as often as you like once bought.'
                        )}
                    </p>
                </div>
                {added ? (
                    <Button asChild variant='outline'>
                        <Link to='/cart'>
                            <ShoppingCart aria-hidden />
                            View cart
                        </Link>
                    </Button>
                ) : (
                    <fetcher.Form
                        method='post'
                        onSubmit={() =>
                            track('added_to_cart', {
                                model: product.slug,
                                model_title: product.title,
                                item_type: 'digital',
                                price_cents: product.digitalPriceCents!,
                            })
                        }
                    >
                        <Button type='submit' name='intent' value='add-to-cart'>
                            <ShoppingCart aria-hidden />
                            Add to cart
                        </Button>
                    </fetcher.Form>
                )}
            </div>
            {error && (
                <p role='alert' className='text-sm text-destructive'>
                    {error}
                </p>
            )}
        </div>
    );
}

/** Counted the same way for free files and bought ones. */
const trackDownload = (product: CatalogProduct) => (file: DownloadableFile) =>
    track('model_downloaded', {
        model: product.slug,
        model_title: product.title,
        category: product.category?.slug ?? null,
        file_format: file.format,
        file_id: file.id,
    });

/** A model the visitor bought: its files to download instead of "Add to cart". */
function OwnedFile({ product, owned }: { product: CatalogProduct; owned: LibraryItem }) {
    return (
        <div className='flex flex-col gap-2'>
            <div>
                <p className='flex items-center gap-2 font-medium [&_svg]:size-4'>
                    <Library aria-hidden />
                    In your library
                </p>
                <p className='text-sm text-muted-foreground'>
                    You own this model. Download it as often as you like, or find it any time in{' '}
                    <Link to='/library' className='underline underline-offset-4 hover:text-foreground'>
                        your library
                    </Link>
                    .
                </p>
            </div>
            {owned.files.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                    This model has no files right now. Contact us and we&apos;ll sort it out.
                </p>
            ) : (
                <FileDownloads slug={product.slug} files={owned.files} onDownload={trackDownload(product)} />
            )}
        </div>
    );
}

/** One download button per file, for anyone. */
function FreeDownload({ product }: { product: CatalogProduct }) {
    const count = product.downloadCount;
    return (
        <div className='flex flex-col gap-2'>
            <div>
                <p className='flex items-center gap-2 font-medium [&_svg]:size-4'>
                    <Download aria-hidden />
                    Free download
                </p>
                <p className='text-sm text-muted-foreground'>
                    No account needed.
                    {count > 0 && ` Downloaded ${count.toLocaleString('en-IE')} ${count === 1 ? 'time' : 'times'}.`}
                </p>
            </div>
            <FileDownloads slug={product.slug} files={product.files} onDownload={trackDownload(product)} />
        </div>
    );
}

type ColourOption = CatalogProduct['colourOptions'][number];

/** How the material has this colour option: `undefined` if it can't print it. */
const inMaterial = (option: ColourOption, materialId: string) =>
    option.materials.find((entry) => entry.materialId === materialId);

/** The option is one of the model's, and in stock in the material. */
function colourInStock(product: CatalogProduct, colourOptionId: unknown, materialId: unknown): boolean {
    const option = product.colourOptions.find((entry) => entry.id === colourOptionId);
    return typeof materialId === 'string' && option !== undefined && inMaterial(option, materialId)?.inStock === true;
}

/** The material chosen at first: the first that has a colour in stock (if the buyer chooses one). */
function firstMaterial(product: CatalogProduct): string | null {
    const materials = product.printOptions.map((option) => option.materialId);
    if (product.colourOptions.length === 0) return materials[0] ?? null;
    return (
        materials.find((id) => firstColour(product, id) !== null) ??
        materials.find((id) => product.colourOptions.some((option) => inMaterial(option, id))) ??
        null
    );
}

/** The material's first colour option in stock. */
function firstColour(product: CatalogProduct, materialId: string | null): string | null {
    if (materialId === null) return null;
    return product.colourOptions.find((option) => inMaterial(option, materialId)?.inStock)?.id ?? null;
}

/**
 * Pick a material, a colour if the model offers a choice, and how many copies. Both are radio buttons, so
 * this works before JavaScript loads. Each material shows its price; the button shows the total once
 * JavaScript runs.
 */
function OrderPrint({ product, inCart }: { product: CatalogProduct; inCart: number }) {
    const fetcher = useFetcher<typeof action>();
    const materials = product.printOptions;
    const colours = product.colourOptions;
    const choosesColour = colours.length > 0;
    const [materialId, setMaterialId] = useState<string | null>(() => firstMaterial(product));
    const [colourOptionId, setColourOptionId] = useState<string | null>(() =>
        firstColour(product, firstMaterial(product)),
    );
    const [quantity, setQuantity] = useState(1);
    const material = materials.find((option) => option.materialId === materialId);
    // The colour options this material can print; others are hidden while it's chosen.
    const shown = colours.filter((option) => materialId !== null && inMaterial(option, materialId) !== undefined);
    const colour = shown.find((option) => option.id === colourOptionId);
    const soldOut = choosesColour && !shown.some((option) => inMaterial(option, materialId!)?.inStock);
    const adding = fetcher.state !== 'idle';
    const error = fetcher.state === 'idle' ? fetcher.data?.error : null;
    const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_PRINT_QUANTITY;
    const chosen = material && [material.name, colour?.name].filter(Boolean).join(', ');

    return (
        <div className='flex flex-col gap-3'>
            <div>
                <p className='flex items-center gap-2 font-medium [&_svg]:size-4'>
                    <Printer aria-hidden />
                    Printed for you · from {formatPrice(product.printBasePriceCents!)}
                </p>
                <p className='text-sm text-muted-foreground'>
                    {inCart > 0 ? (
                        <span className='inline-flex items-center gap-1'>
                            <Check className='size-4' aria-hidden />
                            {inCart} in your cart ·{' '}
                            <Link to='/cart' className='underline underline-offset-4 hover:text-foreground'>
                                View cart
                            </Link>
                        </span>
                    ) : choosesColour ? (
                        'Printed to order in the material and colour you choose.'
                    ) : (
                        'Printed to order in the material you choose.'
                    )}
                </p>
            </div>

            <fetcher.Form
                method='post'
                className='flex flex-col gap-4'
                onChange={(event) => {
                    const form = new FormData(event.currentTarget);
                    const value = (name: string) => {
                        const entry = form.get(name);
                        return typeof entry === 'string' ? entry : null;
                    };
                    const nextMaterial = value('materialId');
                    const nextColour = value('colourOptionId');
                    setMaterialId(nextMaterial);
                    // Keep the colour if the new material has it in stock; otherwise its first one that is.
                    setColourOptionId(
                        nextColour && nextMaterial && colourInStock(product, nextColour, nextMaterial)
                            ? nextColour
                            : firstColour(product, nextMaterial),
                    );
                    setQuantity(Number(form.get('quantity')));
                }}
                onSubmit={() =>
                    material &&
                    track('added_to_cart', {
                        model: product.slug,
                        model_title: product.title,
                        item_type: 'print',
                        price_cents: material.priceCents * quantity,
                    })
                }
            >
                <fieldset className='flex flex-col gap-2'>
                    <legend className='mb-2 text-sm font-medium'>Material</legend>
                    {materials.map((option) => {
                        // With colour options, a material that can print none of them can't be chosen.
                        const usable = !choosesColour || colours.some((entry) => inMaterial(entry, option.materialId));
                        return (
                            <label
                                key={option.materialId}
                                className={cn(
                                    'flex items-start gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
                                    usable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                                )}
                            >
                                <input
                                    type='radio'
                                    name='materialId'
                                    value={option.materialId}
                                    required
                                    disabled={!usable}
                                    checked={option.materialId === materialId}
                                    onChange={() => {}}
                                    className='mt-0.5 size-4 accent-primary'
                                />
                                <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                                    <span className='flex justify-between gap-3 text-sm font-medium'>
                                        <span>{option.name}</span>
                                        <span className='tabular-nums'>{formatPrice(option.priceCents)}</span>
                                    </span>
                                    {option.description && (
                                        <span className='text-xs text-muted-foreground'>{option.description}</span>
                                    )}
                                    {!usable && (
                                        <span className='text-xs text-muted-foreground'>
                                            Not available in this model&apos;s colours.
                                        </span>
                                    )}
                                </span>
                            </label>
                        );
                    })}
                </fieldset>

                {choosesColour ? (
                    <fieldset className='flex flex-col gap-2'>
                        <legend className='mb-2 text-sm font-medium'>
                            Colour
                            {material && <span className='font-normal text-muted-foreground'> in {material.name}</span>}
                        </legend>
                        <div className='flex flex-wrap gap-2'>
                            {shown.map((option) => {
                                const inStock = inMaterial(option, materialId!)?.inStock === true;
                                return (
                                    <label
                                        key={option.id}
                                        title={inStock ? option.name : `${option.name} (out of stock)`}
                                        className={cn('relative', inStock ? 'cursor-pointer' : 'cursor-not-allowed')}
                                    >
                                        <input
                                            type='radio'
                                            name='colourOptionId'
                                            value={option.id}
                                            required
                                            disabled={!inStock}
                                            checked={option.id === colourOptionId}
                                            onChange={() => {}}
                                            className='peer sr-only'
                                        />
                                        <ColourSwatch
                                            colours={option.colours}
                                            className='block size-8 border-2 border-background shadow-[0_0_0_1px_var(--color-border)] peer-checked:shadow-[0_0_0_2px_var(--color-primary)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-40'
                                        />
                                        {!inStock && (
                                            <span
                                                aria-hidden
                                                className='pointer-events-none absolute top-1/2 left-0 h-0.5 w-8 -rotate-45 bg-foreground/60'
                                            />
                                        )}
                                        <span className='sr-only'>
                                            {option.name}
                                            {!inStock && ' (out of stock)'}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </fieldset>
                ) : (
                    <p className='text-sm'>
                        <span className='text-muted-foreground'>Colour:</span> as shown in the photos.
                    </p>
                )}

                <p className='text-sm' aria-live='polite'>
                    {soldOut ? (
                        <span className='text-muted-foreground'>
                            Every colour is out of stock in {material?.name ?? 'this material'} right now.
                        </span>
                    ) : chosen ? (
                        <>
                            <span className='text-muted-foreground'>Chosen:</span> {chosen}
                        </>
                    ) : null}
                </p>

                <div className='flex flex-wrap items-end gap-3'>
                    <div className='flex flex-col gap-1.5'>
                        <label htmlFor='print-quantity' className='text-sm font-medium'>
                            Copies
                        </label>
                        <Input
                            id='print-quantity'
                            name='quantity'
                            type='number'
                            min={1}
                            max={MAX_PRINT_QUANTITY}
                            defaultValue={1}
                            required
                            className='w-20'
                        />
                    </div>
                    <Button type='submit' name='intent' value='add-print' disabled={soldOut || adding}>
                        <ShoppingCart aria-hidden />
                        {material && validQuantity
                            ? `Add to cart · ${formatPrice(material.priceCents * quantity)}`
                            : 'Add to cart'}
                    </Button>
                </div>
                {product.parcelSize && (
                    <p className='text-xs text-muted-foreground'>
                        Ships in a {PARCEL_SIZE_NAMES[product.parcelSize]} parcel:{' '}
                        {formatPrice(INTERIM_SHIPPING_CENTS[product.parcelSize])} shipping. Prints in one order share a
                        parcel, sized for the largest.
                    </p>
                )}
                {error && (
                    <p role='alert' className='text-sm text-destructive'>
                        {error}
                    </p>
                )}
            </fetcher.Form>
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
