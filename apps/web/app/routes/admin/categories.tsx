import { adminCategoryListSchema, categorySchema, type AdminCategory } from '@app/shared';
import { useState } from 'react';
import { Link, useFetcher } from 'react-router';

import { confirmSubmit, Field, FormStatus, Select } from '~/components/admin/form';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { fieldErrors, formValue, parseCategoryForm, slugify } from '~/lib/admin-forms';
import { adminApi, invalid, noContent, runAction, type ActionResult } from '~/lib/admin.server';

import type { Route } from './+types/categories';

export const meta: Route.MetaFunction = () => [
    { title: 'Categories – Admin – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

export async function loader(args: Route.LoaderArgs) {
    const { categories } = await adminApi(args, '/api/admin/categories', adminCategoryListSchema);
    return { categories };
}

export async function action(args: Route.ActionArgs): Promise<ActionResult> {
    const form = await args.request.formData();
    const intent = formValue(form, 'intent');
    const id = formValue(form, 'id');

    if (intent === 'delete') {
        return runAction(async () => {
            await adminApi(args, `/api/admin/categories/${encodeURIComponent(id)}`, noContent, { method: 'DELETE' });
            return 'Category deleted.';
        });
    }

    const parsed = parseCategoryForm(form);
    if (!parsed.ok) return invalid(parsed.issues);

    if (intent === 'create') {
        return runAction(async () => {
            const created = await adminApi(args, '/api/admin/categories', categorySchema, {
                method: 'POST',
                json: parsed.data,
            });
            return `Added “${created.name}”.`;
        });
    }
    return runAction(async () => {
        await adminApi(args, `/api/admin/categories/${encodeURIComponent(id)}`, categorySchema, {
            method: 'PATCH',
            json: parsed.data,
        });
        return 'Saved.';
    });
}

export default function AdminCategories({ loaderData }: Route.ComponentProps) {
    const { categories } = loaderData;
    const topLevel = categories.filter((category) => category.parentId === null);

    return (
        <main className='grid gap-8 lg:grid-cols-[1fr_20rem]'>
            <section aria-labelledby='categories-heading' className='flex flex-col gap-4'>
                <div className='space-y-1'>
                    <h1 id='categories-heading' className='text-3xl font-bold tracking-tight'>
                        Categories
                    </h1>
                    <p className='text-muted-foreground'>
                        Two levels at most: a category, and subcategories inside it. Lower positions come first.
                    </p>
                </div>

                {topLevel.length === 0 ? (
                    <p className='rounded-lg border border-dashed p-8 text-center text-muted-foreground'>
                        No categories yet. Add the first one.
                    </p>
                ) : (
                    <ul className='divide-y rounded-lg border'>
                        {topLevel.map((parent) => {
                            const children = categories.filter((category) => category.parentId === parent.id);
                            return (
                                <li key={parent.id}>
                                    <CategoryRow
                                        category={parent}
                                        categories={categories}
                                        hasChildren={children.length > 0}
                                    />
                                    {children.length > 0 && (
                                        <ul className='divide-y border-t bg-muted/30'>
                                            {children.map((child) => (
                                                <li key={child.id} className='pl-6'>
                                                    <CategoryRow
                                                        category={child}
                                                        categories={categories}
                                                        hasChildren={false}
                                                    />
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            <aside aria-labelledby='new-category-heading' className='lg:pt-[4.5rem]'>
                <h2 id='new-category-heading' className='mb-4 text-lg font-semibold'>
                    New category
                </h2>
                {/* A new key after each added category starts an empty form for the next one. */}
                <NewCategoryForm key={categories.length} categories={categories} />
            </aside>
        </main>
    );
}

function CategoryRow({
    category,
    categories,
    hasChildren,
}: {
    category: AdminCategory;
    categories: AdminCategory[];
    hasChildren: boolean;
}) {
    const fetcher = useFetcher<ActionResult>();
    const result = fetcher.data;
    const errors = result && !result.ok ? fieldErrors(result.issues) : {};
    const busy = fetcher.state !== 'idle';
    const deletable = category.productCount === 0 && !hasChildren;

    return (
        <details className='group' open={result !== undefined && !result.ok ? true : undefined}>
            <summary className='flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50 [&::-webkit-details-marker]:hidden'>
                <span className='font-medium'>{category.name}</span>
                <span className='font-mono text-xs text-muted-foreground'>/{category.slug}</span>
                <span className='ml-auto text-sm text-muted-foreground'>
                    {category.productCount} {category.productCount === 1 ? 'product' : 'products'} · position{' '}
                    {category.position}
                </span>
                <span className='text-sm text-primary group-open:hidden'>Edit</span>
                <span className='hidden text-sm text-primary group-open:inline'>Close</span>
            </summary>

            <div className='grid gap-4 border-t px-4 py-4'>
                <fetcher.Form method='post' className='grid gap-4 sm:grid-cols-2'>
                    <input type='hidden' name='id' value={category.id} />
                    <CategoryFields
                        category={category}
                        categories={categories}
                        hasChildren={hasChildren}
                        errors={errors}
                    />
                    <div className='flex flex-wrap items-center gap-3 sm:col-span-2'>
                        <Button type='submit' name='intent' value='update' size='sm' disabled={busy}>
                            Save
                        </Button>
                        <Button asChild variant='ghost' size='sm'>
                            <Link to={`/categories/${category.slug}`}>View on site</Link>
                        </Button>
                        <FormStatus result={result} fields={Object.keys(errors)} />
                    </div>
                </fetcher.Form>

                <fetcher.Form
                    method='post'
                    onSubmit={confirmSubmit(`Delete the category “${category.name}”?`)}
                    className='flex flex-wrap items-center gap-3 border-t pt-4'
                >
                    <input type='hidden' name='id' value={category.id} />
                    <Button
                        type='submit'
                        name='intent'
                        value='delete'
                        variant='destructive'
                        size='sm'
                        disabled={busy || !deletable}
                    >
                        Delete
                    </Button>
                    {!deletable && (
                        <p className='text-sm text-muted-foreground'>
                            Move its {hasChildren ? 'subcategories' : 'products'} to another category first.
                        </p>
                    )}
                </fetcher.Form>
            </div>
        </details>
    );
}

function CategoryFields({
    category,
    categories,
    hasChildren,
    errors,
    onNameChange,
    slugPlaceholder,
}: {
    category?: AdminCategory;
    categories: AdminCategory[];
    hasChildren: boolean;
    errors: Record<string, string>;
    onNameChange?: (name: string) => void;
    slugPlaceholder?: string;
}) {
    // Only top-level categories can be parents, and a category with subcategories must stay top-level.
    const parents = categories.filter((c) => c.parentId === null && c.id !== category?.id);

    return (
        <>
            <Field label='Name' name='name' error={errors.name}>
                {(control) => (
                    <Input
                        {...control}
                        defaultValue={category?.name}
                        required
                        maxLength={100}
                        onChange={onNameChange ? (event) => onNameChange(event.target.value) : undefined}
                    />
                )}
            </Field>
            <Field
                label='Slug'
                name='slug'
                error={errors.slug}
                hint={
                    category ? 'Changing it breaks old links to the category.' : 'Leave empty to make it from the name.'
                }
            >
                {(control) => (
                    <Input
                        {...control}
                        defaultValue={category?.slug}
                        required={category !== undefined}
                        placeholder={slugPlaceholder}
                        maxLength={100}
                        className='font-mono'
                    />
                )}
            </Field>
            <Field
                label='Parent'
                name='parentId'
                error={errors.parentId}
                hint={hasChildren ? 'It has subcategories, so it stays at the top level.' : undefined}
            >
                {(control) => (
                    <Select {...control} defaultValue={category?.parentId ?? ''} disabled={hasChildren}>
                        <option value=''>None (top level)</option>
                        {parents.map((parent) => (
                            <option key={parent.id} value={parent.id}>
                                {parent.name}
                            </option>
                        ))}
                    </Select>
                )}
            </Field>
            <Field label='Position' name='position' error={errors.position}>
                {(control) => (
                    <Input {...control} type='number' min={0} max={10000} defaultValue={category?.position ?? 0} />
                )}
            </Field>
            <Field label='Description' name='description' error={errors.description} className='sm:col-span-2'>
                {(control) => (
                    <Textarea {...control} defaultValue={category?.description ?? ''} rows={2} maxLength={1000} />
                )}
            </Field>
        </>
    );
}

function NewCategoryForm({ categories }: { categories: AdminCategory[] }) {
    // A keyed fetcher outlives the form, so the "Added" message stays after the form is cleared.
    const fetcher = useFetcher<ActionResult>({ key: 'new-category' });
    const [name, setName] = useState('');
    const result = fetcher.data;
    const errors = result && !result.ok ? fieldErrors(result.issues) : {};

    return (
        <fetcher.Form method='post' className='grid gap-4'>
            <CategoryFields
                categories={categories}
                hasChildren={false}
                errors={errors}
                onNameChange={setName}
                slugPlaceholder={slugify(name) || 'e.g. desk-organisers'}
            />
            <div className='flex flex-wrap items-center gap-3'>
                <Button type='submit' name='intent' value='create' disabled={fetcher.state !== 'idle'}>
                    Add category
                </Button>
                <FormStatus result={result} fields={Object.keys(errors)} />
            </div>
        </fetcher.Form>
    );
}
