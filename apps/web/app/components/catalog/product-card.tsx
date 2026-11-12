import type { CatalogProductCard } from '@app/shared';
import { Box, Download } from 'lucide-react';
import { Link } from 'react-router';

import { Badge } from '~/components/ui/badge';
import { formatCount, offerLines } from '~/lib/format';

interface ProductCardProps {
    product: CatalogProductCard;
    /** Load the image right away (cards above the fold); others load lazily. */
    eager?: boolean;
}

export function ProductCard({ product, eager = false }: ProductCardProps) {
    const offers = offerLines(product);
    return (
        <article className='group relative flex w-full flex-col overflow-hidden rounded-lg border bg-card transition-shadow focus-within:ring-2 focus-within:ring-ring hover:shadow-md'>
            <div className='aspect-[4/3] overflow-hidden bg-muted'>
                {product.cover ? (
                    <img
                        src={product.cover.url}
                        alt={product.cover.alt}
                        width={product.cover.width}
                        height={product.cover.height}
                        loading={eager ? 'eager' : 'lazy'}
                        decoding='async'
                        className='size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'
                    />
                ) : (
                    <div className='flex size-full items-center justify-center text-muted-foreground'>
                        <Box className='size-10' aria-hidden />
                    </div>
                )}
            </div>
            <div className='flex flex-1 flex-col gap-2 p-4'>
                {product.category && <p className='text-xs text-muted-foreground'>{product.category.name}</p>}
                <h3 className='leading-snug font-medium'>
                    {/* The link covers the whole card (::after), so the card is one click target with one accessible name. */}
                    <Link
                        to={`/models/${product.slug}`}
                        prefetch='intent'
                        className='after:absolute after:inset-0 focus-visible:outline-none'
                    >
                        {product.title}
                    </Link>
                </h3>
                <div className='mt-auto flex flex-wrap items-center justify-between gap-2'>
                    <ul className='flex flex-wrap gap-1.5' aria-label='Available as'>
                        {offers.map((offer) => (
                            <li key={offer.kind}>
                                <Badge variant={offer.kind === 'free' ? 'default' : 'secondary'}>{offer.label}</Badge>
                            </li>
                        ))}
                    </ul>
                    {product.downloadCount > 0 && (
                        <p className='flex items-center gap-1 text-xs text-muted-foreground'>
                            <Download className='size-3.5' aria-hidden />
                            <span>
                                {formatCount(product.downloadCount)}
                                <span className='sr-only'> downloads</span>
                            </span>
                        </p>
                    )}
                </div>
            </div>
        </article>
    );
}
