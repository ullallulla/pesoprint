import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '~/components/ui/button';

interface PaginationProps {
    page: number;
    pageCount: number;
    /** The link for a page number. */
    href: (page: number) => string;
}

/** Page numbers around the current page, with the first and last always shown. */
export function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
    const pages = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
    const sorted = [...pages].sort((a, b) => a - b);
    return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1]! > 1 ? ['gap' as const, p] : [p]));
}

export function Pagination({ page, pageCount, href }: PaginationProps) {
    if (pageCount <= 1) return null;
    return (
        <nav aria-label='Pagination' className='flex items-center justify-center gap-1'>
            <PageLink to={page > 1 ? href(page - 1) : null} label='Previous page'>
                <ChevronLeft aria-hidden />
            </PageLink>
            {pageWindow(page, pageCount).map((p, i) =>
                p === 'gap' ? (
                    <span key={`gap-${i}`} className='px-2 text-muted-foreground' aria-hidden>
                        …
                    </span>
                ) : (
                    <Button key={p} asChild variant={p === page ? 'default' : 'ghost'} size='icon'>
                        <Link to={href(p)} aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p}`}>
                            {p}
                        </Link>
                    </Button>
                ),
            )}
            <PageLink to={page < pageCount ? href(page + 1) : null} label='Next page'>
                <ChevronRight aria-hidden />
            </PageLink>
        </nav>
    );
}

function PageLink({ to, label, children }: { to: string | null; label: string; children: React.ReactNode }) {
    if (!to) {
        return (
            <Button variant='ghost' size='icon' disabled aria-label={label}>
                {children}
            </Button>
        );
    }
    return (
        <Button asChild variant='ghost' size='icon'>
            <Link to={to} aria-label={label}>
                {children}
            </Link>
        </Button>
    );
}
