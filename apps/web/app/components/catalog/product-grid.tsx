import type { CatalogProductCard } from '@app/shared';

import { ProductCard } from './product-card';

interface ProductGridProps {
    products: CatalogProductCard[];
    /** How many cards at the start load their image eagerly (above the fold). */
    eagerCount?: number;
}

export function ProductGrid({ products, eagerCount = 4 }: ProductGridProps) {
    return (
        <ul className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {products.map((product, index) => (
                <li key={product.slug} className='flex'>
                    <ProductCard product={product} eager={index < eagerCount} />
                </li>
            ))}
        </ul>
    );
}
