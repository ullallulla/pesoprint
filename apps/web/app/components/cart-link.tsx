import { ShoppingCart } from 'lucide-react';
import { Link } from 'react-router';

/** The header's cart button, with how many items are in it. */
export function CartLink({ count }: { count: number }) {
    const label = count === 0 ? 'Cart, empty' : `Cart, ${count} ${count === 1 ? 'item' : 'items'}`;
    return (
        <Link
            to='/cart'
            aria-label={label}
            className='relative rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground'
        >
            <ShoppingCart className='size-5' aria-hidden />
            {count > 0 && (
                <span
                    className='absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-semibold text-primary-foreground tabular-nums'
                    aria-hidden
                >
                    {count}
                </span>
            )}
        </Link>
    );
}
