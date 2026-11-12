import type { CatalogImage } from '@app/shared';
import { Box } from 'lucide-react';
import { useState } from 'react';

import { cn } from '~/lib/utils';

/** Main image with thumbnails. Without JavaScript the first image still shows. */
export function ProductGallery({ images, title }: { images: CatalogImage[]; title: string }) {
    const [selected, setSelected] = useState(0);
    const current = images[selected] ?? images[0];

    if (!current) {
        return (
            <div className='flex aspect-[4/3] items-center justify-center rounded-lg border bg-muted text-muted-foreground'>
                <Box className='size-16' aria-hidden />
                <span className='sr-only'>No images of {title} yet</span>
            </div>
        );
    }

    return (
        <div className='flex flex-col gap-3'>
            <div className='overflow-hidden rounded-lg border bg-muted'>
                <img
                    src={current.url}
                    alt={current.alt}
                    width={current.width}
                    height={current.height}
                    className='aspect-[4/3] size-full object-contain'
                    fetchPriority='high'
                />
            </div>
            {images.length > 1 && (
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
