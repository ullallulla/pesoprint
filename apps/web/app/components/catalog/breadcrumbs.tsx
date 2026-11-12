import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';

export interface Crumb {
    label: string;
    /** Omit for the current page. */
    to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
    return (
        <nav aria-label='Breadcrumb'>
            <ol className='flex flex-wrap items-center gap-1 text-sm text-muted-foreground'>
                {items.map((item, index) => (
                    <li key={`${item.label}-${index}`} className='flex items-center gap-1'>
                        {index > 0 && <ChevronRight className='size-3.5' aria-hidden />}
                        {item.to ? (
                            <Link to={item.to} className='hover:text-foreground'>
                                {item.label}
                            </Link>
                        ) : (
                            <span aria-current='page' className='text-foreground'>
                                {item.label}
                            </span>
                        )}
                    </li>
                ))}
            </ol>
        </nav>
    );
}
