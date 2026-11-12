import { Box, Search } from 'lucide-react';
import { Form, Link, NavLink } from 'react-router';

import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';

// Only routes that exist are linked. More arrive with each milestone.
const navItems = [{ to: '/models', label: 'Models' }];

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
                    <nav aria-label='Main' className='flex items-center gap-1'>
                        {navItems.map((item) => (
                            <NavLink
                                key={item.to}
                                to={item.to}
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
                <div className='flex items-center gap-2'>
                    <search className='relative hidden sm:block'>
                        <Form method='get' action='/models'>
                            <Search
                                className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground'
                                aria-hidden
                            />
                            <Input
                                type='search'
                                name='q'
                                placeholder='Search models'
                                aria-label='Search models'
                                className='h-9 w-56 pl-8'
                            />
                        </Form>
                    </search>
                    <Link
                        to='/models'
                        className='rounded-md p-2 text-muted-foreground hover:text-foreground sm:hidden'
                        aria-label='Search models'
                    >
                        <Search className='size-5' aria-hidden />
                    </Link>
                    {children}
                </div>
            </div>
        </header>
    );
}
