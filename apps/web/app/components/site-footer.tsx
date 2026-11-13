import { Link } from 'react-router';

import { CookieSettingsButton } from '~/components/analytics';

// Computed once per server start, outside render, so rendering stays pure.
const currentYear = new Date().getFullYear();

const linkClass = 'text-muted-foreground transition-colors hover:text-foreground';

export function SiteFooter() {
    return (
        <footer className='border-t'>
            <div className='mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-6 text-sm md:h-16 md:flex-row md:py-0'>
                <p className='text-muted-foreground'>© {currentYear} Pesoprint. All rights reserved.</p>
                <nav aria-label='Legal' className='flex flex-wrap items-center justify-center gap-x-6 gap-y-2'>
                    <Link to='/terms' className={linkClass}>
                        Terms of use
                    </Link>
                    <Link to='/privacy' className={linkClass}>
                        Privacy policy
                    </Link>
                    {/* Only when analytics are on: otherwise there's nothing optional to choose. */}
                    <CookieSettingsButton className={linkClass} />
                </nav>
            </div>
        </footer>
    );
}
