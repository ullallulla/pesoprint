import { adminMaterialListSchema, colourSchema, materialSchema, type AdminMaterial, type Colour } from '@app/shared';
import { useFetcher } from 'react-router';

import { confirmSubmit, Field, FormStatus } from '~/components/admin/form';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { fieldErrors, formValue, parseColourForm, parseMaterialForm } from '~/lib/admin-forms';
import { adminApi, invalid, noContent, runAction, type ActionResult } from '~/lib/admin.server';

import type { Route } from './+types/materials';

export const meta: Route.MetaFunction = () => [
    { title: 'Materials – Admin – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

export async function loader(args: Route.LoaderArgs) {
    const { materials } = await adminApi(args, '/api/admin/materials', adminMaterialListSchema);
    return { materials };
}

export async function action(args: Route.ActionArgs): Promise<ActionResult> {
    const form = await args.request.formData();
    const intent = formValue(form, 'intent');
    const id = encodeURIComponent(formValue(form, 'id'));

    switch (intent) {
        case 'delete-material':
            return runAction(async () => {
                await adminApi(args, `/api/admin/materials/${id}`, noContent, { method: 'DELETE' });
                return 'Material deleted.';
            });
        case 'delete-colour':
            return runAction(async () => {
                await adminApi(args, `/api/admin/colours/${id}`, noContent, { method: 'DELETE' });
                return 'Colour deleted.';
            });
        case 'set-stock': {
            const inStock = formValue(form, 'inStock') === 'true';
            return runAction(async () => {
                await adminApi(args, `/api/admin/colours/${id}`, colourSchema, {
                    method: 'PATCH',
                    json: { inStock },
                });
                return undefined;
            });
        }
        case 'create-material':
        case 'update-material': {
            const parsed = parseMaterialForm(form);
            if (!parsed.ok) return invalid(parsed.issues);
            const create = intent === 'create-material';
            return runAction(async () => {
                const material = await adminApi(
                    args,
                    create ? '/api/admin/materials' : `/api/admin/materials/${id}`,
                    materialSchema,
                    { method: create ? 'POST' : 'PATCH', json: parsed.data },
                );
                return create ? `Added “${material.name}”.` : 'Saved.';
            });
        }
        case 'add-colour':
        case 'update-colour': {
            const parsed = parseColourForm(form);
            if (!parsed.ok) return invalid(parsed.issues);
            const add = intent === 'add-colour';
            return runAction(async () => {
                const colour = await adminApi(
                    args,
                    add ? `/api/admin/materials/${id}/colours` : `/api/admin/colours/${id}`,
                    colourSchema,
                    { method: add ? 'POST' : 'PATCH', json: parsed.data },
                );
                return add ? `Added “${colour.name}”.` : 'Saved.';
            });
        }
        default:
            return invalid([], 'Unknown action.');
    }
}

export default function AdminMaterials({ loaderData }: Route.ComponentProps) {
    const { materials } = loaderData;

    return (
        <main className='grid gap-8 lg:grid-cols-[1fr_20rem]'>
            <section aria-labelledby='materials-heading' className='flex flex-col gap-4'>
                <div className='space-y-1'>
                    <h1 id='materials-heading' className='text-3xl font-bold tracking-tight'>
                        Materials
                    </h1>
                    <p className='text-muted-foreground'>
                        What prints can be made of, and the colours you have. Each model chooses its materials and sets
                        a price for each. Lower positions come first.
                    </p>
                </div>

                {materials.length === 0 ? (
                    <p className='rounded-lg border border-dashed p-8 text-center text-muted-foreground'>
                        No materials yet. Add the first one.
                    </p>
                ) : (
                    <ul className='flex flex-col gap-4'>
                        {materials.map((material) => (
                            <li key={material.id}>
                                <MaterialCard material={material} />
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <aside aria-labelledby='new-material-heading' className='lg:pt-[4.5rem]'>
                <h2 id='new-material-heading' className='mb-4 text-lg font-semibold'>
                    New material
                </h2>
                {/* A new key after each added material starts an empty form for the next one. */}
                <NewMaterialForm key={materials.length} />
            </aside>
        </main>
    );
}

function MaterialCard({ material }: { material: AdminMaterial }) {
    const inStock = material.colours.filter((colour) => colour.inStock).length;

    return (
        <section aria-label={material.name} className='rounded-lg border'>
            <MaterialRow material={material} inStock={inStock} />
            <ul className='divide-y border-t'>
                {material.colours.map((colour) => (
                    <li key={colour.id}>
                        <ColourRow colour={colour} />
                    </li>
                ))}
            </ul>
            {/* A new key after each added colour starts an empty form for the next one. */}
            <AddColourForm key={material.colours.length} material={material} />
        </section>
    );
}

function MaterialRow({ material, inStock }: { material: AdminMaterial; inStock: number }) {
    const fetcher = useFetcher<ActionResult>();
    const result = fetcher.data;
    const errors = result && !result.ok ? fieldErrors(result.issues) : {};
    const busy = fetcher.state !== 'idle';
    const count = material.colours.length;

    return (
        <details className='group' open={result !== undefined && !result.ok ? true : undefined}>
            <summary className='flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50 [&::-webkit-details-marker]:hidden'>
                <span className='text-lg font-semibold'>{material.name}</span>
                {!material.active && <Badge variant='secondary'>Inactive</Badge>}
                <span className='ml-auto text-sm text-muted-foreground'>
                    {count} {count === 1 ? 'colour' : 'colours'}, {inStock} in stock · position {material.position}
                </span>
                <span className='text-sm text-primary group-open:hidden'>Edit</span>
                <span className='hidden text-sm text-primary group-open:inline'>Close</span>
            </summary>

            <div className='grid gap-4 border-t px-4 py-4'>
                <fetcher.Form method='post' className='grid gap-4 sm:grid-cols-2'>
                    <input type='hidden' name='id' value={material.id} />
                    <MaterialFields material={material} errors={errors} />
                    <div className='flex flex-wrap items-center gap-3 sm:col-span-2'>
                        <Button type='submit' name='intent' value='update-material' size='sm' disabled={busy}>
                            Save
                        </Button>
                        <FormStatus result={result} fields={Object.keys(errors)} />
                    </div>
                </fetcher.Form>

                <fetcher.Form
                    method='post'
                    onSubmit={confirmSubmit(
                        `Delete “${material.name}”${count > 0 ? ` and its ${count} ${count === 1 ? 'colour' : 'colours'}` : ''}?`,
                    )}
                    className='flex flex-wrap items-center gap-3 border-t pt-4'
                >
                    <input type='hidden' name='id' value={material.id} />
                    <Button
                        type='submit'
                        name='intent'
                        value='delete-material'
                        variant='destructive'
                        size='sm'
                        disabled={busy}
                    >
                        Delete
                    </Button>
                    <p className='text-sm text-muted-foreground'>
                        Once models or orders use it, make it inactive instead.
                    </p>
                </fetcher.Form>
            </div>
        </details>
    );
}

function MaterialFields({ material, errors }: { material?: AdminMaterial; errors: Record<string, string> }) {
    return (
        <>
            <Field label='Name' name='name' error={errors.name}>
                {(control) => (
                    <Input {...control} defaultValue={material?.name} required maxLength={50} placeholder='e.g. PETG' />
                )}
            </Field>
            <Field label='Position' name='position' error={errors.position}>
                {(control) => (
                    <Input {...control} type='number' min={0} max={10000} defaultValue={material?.position ?? 0} />
                )}
            </Field>
            <Field
                label='Description'
                name='description'
                error={errors.description}
                hint='Shown to buyers when they pick a material.'
                className='sm:col-span-2'
            >
                {(control) => (
                    <Textarea
                        {...control}
                        defaultValue={material?.description ?? ''}
                        rows={2}
                        maxLength={300}
                        placeholder='e.g. Tough and slightly flexible. Good for parts that take a knock.'
                    />
                )}
            </Field>
            <label className='flex items-center gap-2 text-sm sm:col-span-2'>
                <input
                    type='checkbox'
                    name='active'
                    defaultChecked={material?.active ?? true}
                    className='size-4 accent-primary'
                />
                Active (buyers can choose it)
            </label>
        </>
    );
}

function NewMaterialForm() {
    // A keyed fetcher outlives the form, so the "Added" message stays after the form is cleared.
    const fetcher = useFetcher<ActionResult>({ key: 'new-material' });
    const result = fetcher.data;
    const errors = result && !result.ok ? fieldErrors(result.issues) : {};

    return (
        <fetcher.Form method='post' className='grid gap-4'>
            <MaterialFields errors={errors} />
            <div className='flex flex-wrap items-center gap-3'>
                <Button type='submit' name='intent' value='create-material' disabled={fetcher.state !== 'idle'}>
                    Add material
                </Button>
                <FormStatus result={result} fields={Object.keys(errors)} />
            </div>
        </fetcher.Form>
    );
}

function Swatch({ hex }: { hex: string }) {
    return (
        <span
            aria-hidden
            className='inline-block size-5 shrink-0 rounded-full border shadow-xs'
            style={{ backgroundColor: hex }}
        />
    );
}

function ColourRow({ colour }: { colour: Colour }) {
    const fetcher = useFetcher<ActionResult>();
    const stock = useFetcher<ActionResult>();
    const result = fetcher.data;
    const errors = result && !result.ok ? fieldErrors(result.issues) : {};
    const busy = fetcher.state !== 'idle';
    // Show the new stock state straight away, while the request is on its way.
    const inStock = stock.formData ? stock.formData.get('inStock') === 'true' : colour.inStock;

    return (
        <details className='group/colour' open={result !== undefined && !result.ok ? true : undefined}>
            <summary className='flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-muted/50 [&::-webkit-details-marker]:hidden'>
                <Swatch hex={colour.hex} />
                <span className={inStock ? 'font-medium' : 'font-medium text-muted-foreground line-through'}>
                    {colour.name}
                </span>
                <span className='font-mono text-xs text-muted-foreground'>{colour.hex}</span>
                {!inStock && <Badge variant='outline'>Out of stock</Badge>}
                <span className='ml-auto text-sm text-primary group-open/colour:hidden'>Edit</span>
                <span className='ml-auto hidden text-sm text-primary group-open/colour:inline'>Close</span>
            </summary>

            <div className='grid gap-4 border-t bg-muted/30 px-4 py-4'>
                <stock.Form method='post' className='flex flex-wrap items-center gap-3'>
                    <input type='hidden' name='id' value={colour.id} />
                    <input type='hidden' name='inStock' value={String(!inStock)} />
                    <Button type='submit' name='intent' value='set-stock' variant='outline' size='sm'>
                        {inStock ? 'Mark out of stock' : 'Mark in stock'}
                    </Button>
                    <FormStatus result={stock.data} />
                </stock.Form>

                <fetcher.Form method='post' className='grid gap-4 sm:grid-cols-[1fr_auto_8rem]'>
                    <input type='hidden' name='id' value={colour.id} />
                    {/* Saving the form keeps the stock state as it is. */}
                    {inStock && <input type='hidden' name='inStock' value='on' />}
                    <ColourFields colour={colour} errors={errors} />
                    <div className='flex flex-wrap items-center gap-3 sm:col-span-3'>
                        <Button type='submit' name='intent' value='update-colour' size='sm' disabled={busy}>
                            Save
                        </Button>
                        <FormStatus result={result} fields={Object.keys(errors)} />
                    </div>
                </fetcher.Form>

                <fetcher.Form
                    method='post'
                    onSubmit={confirmSubmit(`Delete the colour “${colour.name}”?`)}
                    className='flex flex-wrap items-center gap-3 border-t pt-4'
                >
                    <input type='hidden' name='id' value={colour.id} />
                    <Button
                        type='submit'
                        name='intent'
                        value='delete-colour'
                        variant='destructive'
                        size='sm'
                        disabled={busy}
                    >
                        Delete
                    </Button>
                    <p className='text-sm text-muted-foreground'>Once orders use it, mark it out of stock instead.</p>
                </fetcher.Form>
            </div>
        </details>
    );
}

function ColourFields({ colour, errors }: { colour?: Colour; errors: Record<string, string> }) {
    return (
        <>
            <Field label='Colour name' name='name' error={errors.name}>
                {(control) => (
                    <Input
                        {...control}
                        defaultValue={colour?.name}
                        required
                        maxLength={50}
                        placeholder='e.g. Galaxy black'
                    />
                )}
            </Field>
            <Field label='Swatch' name='hex' error={errors.hex}>
                {(control) => (
                    <input
                        {...control}
                        type='color'
                        defaultValue={colour?.hex ?? '#000000'}
                        className='h-9 w-14 cursor-pointer rounded-md border border-input bg-transparent p-1'
                    />
                )}
            </Field>
            <Field label='Position' name='position' error={errors.position}>
                {(control) => (
                    <Input {...control} type='number' min={0} max={10000} defaultValue={colour?.position ?? 0} />
                )}
            </Field>
        </>
    );
}

function AddColourForm({ material }: { material: AdminMaterial }) {
    // Keyed by material: the "Added" message stays after the form is cleared.
    const fetcher = useFetcher<ActionResult>({ key: `add-colour-${material.id}` });
    const result = fetcher.data;
    const errors = result && !result.ok ? fieldErrors(result.issues) : {};

    return (
        <fetcher.Form
            method='post'
            aria-label={`Add a colour to ${material.name}`}
            className='grid gap-4 border-t px-4 py-4 sm:grid-cols-[1fr_auto_8rem]'
        >
            <input type='hidden' name='id' value={material.id} />
            <input type='hidden' name='inStock' value='on' />
            <ColourFields errors={errors} />
            <div className='flex flex-wrap items-center gap-3 sm:col-span-3'>
                <Button
                    type='submit'
                    name='intent'
                    value='add-colour'
                    variant='outline'
                    size='sm'
                    disabled={fetcher.state !== 'idle'}
                >
                    Add colour
                </Button>
                <FormStatus result={result} fields={Object.keys(errors)} />
            </div>
        </fetcher.Form>
    );
}
