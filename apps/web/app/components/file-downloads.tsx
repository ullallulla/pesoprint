import type { ProductFileFormat } from '@app/shared';
import { Download } from 'lucide-react';

import { buttonVariants } from '~/components/ui/button';
import { formatBytes } from '~/lib/format';

export interface DownloadableFile {
    id: string;
    format: ProductFileFormat;
    filename: string;
    sizeBytes: number;
}

/**
 * One download button per file. Plain links: the download route checks access and redirects to the file,
 * so the browser saves it and stays on the page.
 */
export function FileDownloads({
    slug,
    files,
    onDownload,
}: {
    /** The model's slug, for the download link. */
    slug: string;
    files: DownloadableFile[];
    onDownload?: (file: DownloadableFile) => void;
}) {
    return (
        <ul className='flex flex-col gap-2'>
            {files.map((file) => (
                <li key={file.id} className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='min-w-0 truncate text-sm'>
                        {file.filename}{' '}
                        <span className='text-muted-foreground'>
                            ({file.format.toUpperCase()}, {formatBytes(file.sizeBytes)})
                        </span>
                    </span>
                    <a
                        href={`/models/${slug}/download/${file.id}`}
                        rel='nofollow'
                        className={buttonVariants({ size: 'sm' })}
                        aria-label={`Download ${file.filename}`}
                        onClick={onDownload ? () => onDownload(file) : undefined}
                    >
                        <Download aria-hidden />
                        Download
                    </a>
                </li>
            ))}
        </ul>
    );
}
