import { Box } from 'lucide-react';
import { Link, NavLink } from 'react-router';

import { cn } from '~/lib/utils';

// Only routes that exist are linked. More arrive with each milestone (catalogue in M1).
const navItems = [{ to: '/', label: 'Home' }];

/** `children` is the right-hand side (sign-in / user menu). Error pages render the header without it. */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
    return (
        <header className='sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60'>
            <div className='mx-auto flex h-16 max-w-7xl items-center justify-between px-4'>
                <div className='flex items-center gap-6'>
                    <Link to='/' className='flex items-center gap-2 text-xl font-bold'>
                        <Box className='size-6' aria-hidden />
                        <span>Pesoprint</span>
                    </Link>
                    <nav aria-label='Main' className='hidden items-center gap-1 md:flex'>
                        {navItems.map((item) => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end
                                className={({ isActive }) =>
                                    cn(
                                        'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                                        isActive && 'text-foreground',
                                    )
                                }
                            >
                                {item.label}
                            </NavLink>
                        ))}
                    </nav>
                </div>
                <div className='flex items-center gap-2'>{children}</div>
            </div>
        </header>
    );
}
