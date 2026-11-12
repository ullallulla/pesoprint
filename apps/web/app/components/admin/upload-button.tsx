import type { UploadTarget } from '@app/shared';
import { cn } from 'cn';
import { CircleAlert, Upload } from 'lucide-react';
import { useId, useState } from 'react';
import { useRevalidator } from 'react-router';

import { buttonVariants } from '~/components/ui/button';
import { UPLOAD_ACCEPT, uploadProductMedia } from '~/lib/admin-upload';

interface UploadState {
    name: string;
    progress: number;
    error?: string;
}

interface UploadButtonProps {
    productId: string;
    target: UploadTarget;
    label: string;
    multiple?: boolean;
    /** Alt text for new images, until it's edited. */
    alt?: (file: File) => string;
}

/**
 * Picks files and uploads them one after another, showing each one's progress. When they're done the
 * page reloads its data, so the new images or files appear in the list.
 */
export function UploadButton({ productId, target, label, multiple = false, alt }: UploadButtonProps) {
    const id = useId();
    const revalidator = useRevalidator();
    const [uploads, setUploads] = useState<UploadState[]>([]);
    const busy = uploads.some((upload) => upload.progress < 1 && !upload.error);

    async function upload(files: File[]) {
        setUploads(files.map((file) => ({ name: file.name, progress: 0 })));
        const update = (index: number, changes: Partial<UploadState>) =>
            setUploads((current) => current.map((entry, i) => (i === index ? { ...entry, ...changes } : entry)));

        for (const [index, file] of files.entries()) {
            try {
                await uploadProductMedia({
                    productId,
                    target,
                    file,
                    alt: alt?.(file),
                    onProgress: (progress) => update(index, { progress: Math.min(progress, 0.99) }),
                });
                update(index, { progress: 1 });
            } catch (error) {
                update(index, { error: error instanceof Error ? error.message : 'The upload failed.' });
            }
        }
        await revalidator.revalidate();
        // Finished uploads now show in the list above; keep only the failures on screen.
        setUploads((current) => current.filter((entry) => entry.error));
    }

    return (
        <div className='grid gap-2'>
            <div>
                <label
                    htmlFor={id}
                    className={cn(
                        buttonVariants({ variant: 'outline', size: 'sm' }),
                        'cursor-pointer has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                        busy && 'pointer-events-none opacity-50',
                    )}
                >
                    <Upload aria-hidden />
                    {label}
                    <input
                        id={id}
                        type='file'
                        className='sr-only'
                        accept={UPLOAD_ACCEPT[target]}
                        multiple={multiple}
                        disabled={busy}
                        onChange={(event) => {
                            const files = [...(event.target.files ?? [])];
                            event.target.value = '';
                            if (files.length > 0) void upload(files);
                        }}
                    />
                </label>
            </div>
            {uploads.length > 0 && (
                <ul className='grid gap-2 text-sm' aria-label='Uploads'>
                    {uploads.map((entry, index) => (
                        <li key={`${index}-${entry.name}`} className='grid gap-1'>
                            <div className='flex items-center justify-between gap-2'>
                                <span className='truncate'>{entry.name}</span>
                                {!entry.error && (
                                    <span className='text-muted-foreground tabular-nums'>
                                        {Math.round(entry.progress * 100)}%
                                    </span>
                                )}
                            </div>
                            {entry.error ? (
                                <p role='alert' className='flex gap-2 text-destructive'>
                                    <CircleAlert className='mt-0.5 size-4 shrink-0' aria-hidden />
                                    {entry.error}
                                </p>
                            ) : (
                                <progress
                                    className='h-1.5 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary'
                                    value={entry.progress}
                                    aria-label={`Uploading ${entry.name}`}
                                />
                            )}
                        </li>
                    ))}
                </ul>
            )}
            <noscript>
                <p className='text-sm text-muted-foreground'>Uploading needs JavaScript.</p>
            </noscript>
        </div>
    );
}
