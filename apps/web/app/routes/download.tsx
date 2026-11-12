import { data, isRouteErrorResponse, Link, redirect, useParams } from 'react-router';
import { z } from 'zod';

import { Button } from '~/components/ui/button';
import { ApiRequestError } from '~/lib/api.server';
import { requestDownload } from '~/lib/downloads.server';

import type { Route } from './+types/download';

export const meta: Route.MetaFunction = () => [
    { title: 'Download – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

/**
 * `/models/:slug/download/:fileId`: the Download buttons link here with a plain `<a>`. The API checks
 * access and logs the download; the browser is then sent to the short-lived file link and saves the file,
 * staying on the product page. Only errors render anything.
 */
export async function loader(args: Route.LoaderArgs) {
    if (!z.uuid().safeParse(args.params.fileId).success) {
        throw data(null, { status: 404 });
    }
    try {
        const link = await requestDownload(args, args.params.fileId);
        return redirect(link.url, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        if (error instanceof ApiRequestError && [404, 429, 503].includes(error.status)) {
            throw data(error.message, { status: error.status });
        }
        throw error;
    }
}

export default function Download() {
    return null;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    const { slug } = useParams();
    const status = isRouteErrorResponse(error) ? error.status : 500;
    const [title, text] =
        status === 404
            ? ["This file isn't available", 'The model may have been removed, or its file is no longer offered.']
            : status === 429
              ? [
                    'Too many downloads',
                    // The API says how long to wait, e.g. "Try again in 12 minutes."
                    isRouteErrorResponse(error) && typeof error.data === 'string'
                        ? error.data
                        : 'Please wait a while and try again.',
                ]
              : ["The download couldn't start", 'Something went wrong on our side. Try again in a moment.'];

    return (
        <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col items-start gap-4 px-4 py-16'>
            <h1 className='text-3xl font-bold'>{title}</h1>
            <p className='text-muted-foreground'>{text}</p>
            <Button asChild variant='outline'>
                <Link to={slug ? `/models/${slug}` : '/models'}>Back to the model</Link>
            </Button>
        </main>
    );
}
