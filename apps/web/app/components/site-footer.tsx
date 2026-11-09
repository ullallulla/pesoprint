// Computed once per server start, outside render, so rendering stays pure.
const currentYear = new Date().getFullYear();

export function SiteFooter() {
    return (
        <footer className='border-t'>
            <div className='mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-6 md:h-16 md:flex-row md:py-0'>
                <p className='text-sm text-muted-foreground'>© {currentYear} Pesoprint. All rights reserved.</p>
                {/* Terms, privacy and contact pages are added in M2. */}
            </div>
        </footer>
    );
}
