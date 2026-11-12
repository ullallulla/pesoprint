import { cn } from 'cn';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useId } from 'react';

import { Label } from '~/components/ui/label';
import type { ActionResult } from '~/lib/admin.server';

/** Props a field's control needs so the label, hint and error are announced with it. */
export interface ControlProps {
    id: string;
    name: string;
    'aria-invalid': true | undefined;
    'aria-describedby': string | undefined;
}

interface FieldProps {
    label: React.ReactNode;
    name: string;
    error?: string;
    hint?: React.ReactNode;
    className?: string;
    children: (control: ControlProps) => React.ReactNode;
}

/** A labelled form control with an optional hint and error message. */
export function Field({ label, name, error, hint, className, children }: FieldProps) {
    const id = useId();
    const hintId = hint ? `${id}-hint` : undefined;
    const errorId = error ? `${id}-error` : undefined;
    const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

    return (
        <div className={cn('grid content-start gap-1.5', className)}>
            <Label htmlFor={id}>{label}</Label>
            {children({ id, name, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
            {hint && (
                <p id={hintId} className='text-xs text-muted-foreground'>
                    {hint}
                </p>
            )}
            {error && (
                <p id={errorId} className='text-sm text-destructive'>
                    {error}
                </p>
            )}
        </div>
    );
}

/** A native `<select>` styled like the text inputs. Works without JavaScript. */
export function Select({ className, ...props }: React.ComponentProps<'select'>) {
    return (
        <select
            className={cn(
                'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 py-1 text-base shadow-xs outline-none md:text-sm dark:bg-input/30',
                'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
                'disabled:cursor-not-allowed disabled:opacity-50',
                className,
            )}
            {...props}
        />
    );
}

/**
 * The outcome of the last submit. `<output>` (a status) and `role=alert` make screen readers announce it.
 * Errors that belong to a field are shown at the field, so only the summary is repeated here.
 */
export function FormStatus({
    result,
    fields = [],
    className,
}: {
    result: ActionResult | undefined;
    /** Paths of the issues this form shows at its fields. The rest are listed here. */
    fields?: readonly string[];
    className?: string;
}) {
    if (!result) return null;
    if (result.ok) {
        if (!result.message) return null;
        return (
            <output className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
                <CircleCheck className='size-4 shrink-0 text-green-600' aria-hidden />
                {result.message}
            </output>
        );
    }
    const unplaced = result.issues.filter((issue) => !fields.includes(issue.path));
    return (
        <div role='alert' className={cn('flex gap-2 text-sm text-destructive', className)}>
            <CircleAlert className='mt-0.5 size-4 shrink-0' aria-hidden />
            <div>
                <p>{result.message}</p>
                {unplaced.length > 0 && (
                    <ul className='mt-1 list-disc pl-5'>
                        {unplaced.map((issue) => (
                            <li key={`${issue.path}:${issue.message}`}>{issue.message}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

/** Asks before a destructive submit. Without JavaScript the form submits straight away. */
export function confirmSubmit(message: string) {
    return (event: React.FormEvent<HTMLFormElement>) => {
        if (!window.confirm(message)) event.preventDefault();
    };
}
