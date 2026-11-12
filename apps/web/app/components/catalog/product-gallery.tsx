import type { CatalogImage } from '@app/shared';
import { Box, Images } from 'lucide-react';
import { useState } from 'react';

import { cn } from '~/lib/utils';

import { LazyModelViewer, useIsClient } from './lazy-model-viewer';

interface ProductGalleryProps {
    images: CatalogImage[];
    title: string;
    /** The public 3D preview, if the product has one. */
    preview?: { url: string } | null;
}

/** Photos with thumbnails, and the 3D view when there is a preview. Without JavaScript the first photo shows. */
export function ProductGallery({ images, title, preview }: ProductGalleryProps) {
    const [selected, setSelected] = useState(0);
    const [view, setView] = useState<'photos' | '3d'>('photos');
    // The 3D view needs JavaScript, so its button only appears once the page is interactive.
    const interactive = useIsClient();

    const current = images[selected] ?? images[0];
    const show3d = view === '3d' && preview;

    return (
        <div className='flex flex-col gap-3'>
            <div className='relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted'>
                {show3d ? (
                    <LazyModelViewer url={preview.url} title={title} />
                ) : current ? (
                    <img
                        src={current.url}
                        alt={current.alt}
                        width={current.width}
                        height={current.height}
                        className='absolute inset-0 size-full object-contain'
                        fetchPriority='high'
                    />
                ) : (
                    <Centered>
                        <Box className='size-16' aria-hidden />
                        <span className='sr-only'>No images of {title} yet</span>
                    </Centered>
                )}
            </div>

            {preview && interactive && (
                <div className='flex gap-2'>
                    <ViewButton active={view === 'photos'} onClick={() => setView('photos')}>
                        <Images className='size-4' aria-hidden />
                        Photos
                    </ViewButton>
                    <ViewButton active={view === '3d'} onClick={() => setView('3d')}>
                        <Box className='size-4' aria-hidden />
                        3D view
                    </ViewButton>
                </div>
            )}

            {view === 'photos' && images.length > 1 && (
                <ul className='flex gap-2 overflow-x-auto' aria-label='Images'>
                    {images.map((image, index) => (
                        <li key={image.url} className='shrink-0'>
                            <button
                                type='button'
                                onClick={() => setSelected(index)}
                                aria-label={`Show image ${index + 1}: ${image.alt}`}
                                aria-pressed={index === selected}
                                className={cn(
                                    'block overflow-hidden rounded-md border-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                    index === selected ? 'border-primary' : 'border-transparent hover:border-border',
                                )}
                            >
                                <img
                                    src={image.url}
                                    alt=''
                                    width={image.width}
                                    height={image.height}
                                    loading='lazy'
                                    className='aspect-[4/3] w-24 object-cover'
                                />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function ViewButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type='button'
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
        >
            {children}
        </button>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return (
        <div className='absolute inset-0 flex items-center justify-center text-sm text-muted-foreground'>
            {children}
        </div>
    );
}
