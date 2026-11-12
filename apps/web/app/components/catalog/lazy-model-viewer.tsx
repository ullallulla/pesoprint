import { lazy, Suspense, useSyncExternalStore } from 'react';

// three.js is large: it's only downloaded when a viewer is actually shown.
const ModelViewer = lazy(() => import('./model-viewer'));

const noSubscription = () => () => {};

/** `false` while server rendering and hydrating, `true` once the page runs in the browser. */
export function useIsClient(): boolean {
    return useSyncExternalStore(
        noSubscription,
        () => true,
        () => false,
    );
}

/**
 * The 3D viewer, loaded on demand and only in the browser (it needs WebGL). Fills its parent, which
 * should have a size, e.g. `relative aspect-[4/3]`.
 */
export function LazyModelViewer({ url, title }: { url: string; title: string }) {
    const isClient = useIsClient();
    const loading = (
        <div className='absolute inset-0 flex items-center justify-center text-sm text-muted-foreground'>
            Loading the 3D viewer…
        </div>
    );
    if (!isClient) return loading;
    return (
        <Suspense fallback={loading}>
            {/* A new file means a new viewer, so the camera frames the new model. */}
            <ModelViewer key={url} url={url} title={title} />
        </Suspense>
    );
}
