import { healthResponseSchema, type HealthResponse } from '@app/shared';
import { CheckCircle2, CircleAlert } from 'lucide-react';

import { Button } from '~/components/ui/button';
import { apiFetch } from '~/lib/api.server';

import type { Route } from './+types/home';

export const meta: Route.MetaFunction = () => {
    return [
        { title: 'Pesoprint – 3D models and prints' },
        {
            name: 'description',
            content: 'Download free 3D models, buy model files, or order them printed in your colour and material.',
        },
    ];
};

export async function loader() {
    let health: HealthResponse | null = null;
    try {
        health = await apiFetch('/api/health', healthResponseSchema, { acceptStatuses: [503] });
    } catch {
        // API unreachable: the page still renders, the status card shows it as offline.
    }
    return { health };
}

export default function Home({ loaderData }: Route.ComponentProps) {
    const { health } = loaderData;

    return (
        <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col gap-12 px-4 py-16'>
            <section className='max-w-2xl space-y-6'>
                <h1 className='text-4xl font-bold tracking-tight md:text-5xl'>3D models, ready to print.</h1>
                <p className='text-lg text-muted-foreground'>
                    Download free models, buy files for your own printer, or let us print and ship them in the colour
                    and material you choose.
                </p>
                <div className='flex gap-3'>
                    <Button size='lg' disabled>
                        Browse models (coming soon)
                    </Button>
                </div>
            </section>

            <section aria-labelledby='status-heading' className='max-w-md rounded-lg border p-4'>
                <h2 id='status-heading' className='mb-2 text-sm font-medium text-muted-foreground'>
                    System status
                </h2>
                <ApiStatus health={health} />
            </section>
        </main>
    );
}

function ApiStatus({ health }: { health: HealthResponse | null }) {
    if (!health) {
        return (
            <p className='flex items-center gap-2 text-destructive'>
                <CircleAlert className='size-4' aria-hidden /> API offline
            </p>
        );
    }
    const ok = health.status === 'ok';
    return (
        <p className={ok ? 'flex items-center gap-2' : 'flex items-center gap-2 text-destructive'}>
            {ok ? (
                <CheckCircle2 className='size-4 text-green-600' aria-hidden />
            ) : (
                <CircleAlert className='size-4' aria-hidden />
            )}
            API {ok ? 'online' : 'degraded'} · database {health.database} · v{health.version}
        </p>
    );
}
