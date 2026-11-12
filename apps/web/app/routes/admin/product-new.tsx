import { adminProductSchema } from '@app/shared';
import { useState } from 'react';
import { Form, redirect, useNavigation } from 'react-router';

import { Field, FormStatus } from '~/components/admin/form';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { fieldErrors, parseNewProductForm, slugify } from '~/lib/admin-forms';
import { adminApi, invalid, runAction } from '~/lib/admin.server';

import type { Route } from './+types/product-new';

export const meta: Route.MetaFunction = () => [
    { title: 'New product – Admin – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

export async function action(args: Route.ActionArgs) {
    const parsed = parseNewProductForm(await args.request.formData());
    if (!parsed.ok) return invalid(parsed.issues);

    let id: string | undefined;
    const result = await runAction(async () => {
        ({ id } = await adminApi(args, '/api/admin/products', adminProductSchema, {
            method: 'POST',
            json: parsed.data,
        }));
        return undefined;
    });
    // Everything else (prices, files, images) is added on the product's own page.
    return id ? redirect(`/admin/products/${id}`) : result;
}

export default function NewProduct({ actionData }: Route.ComponentProps) {
    const [title, setTitle] = useState('');
    const navigation = useNavigation();
    const errors = actionData && !actionData.ok ? fieldErrors(actionData.issues) : {};

    return (
        <main className='flex max-w-xl flex-col gap-6'>
            <div className='space-y-1'>
                <h1 className='text-3xl font-bold tracking-tight'>New product</h1>
                <p className='text-muted-foreground'>
                    It starts as a draft. Add the details, images and files next, then publish it.
                </p>
            </div>
            <Form method='post' className='grid gap-4'>
                <Field label='Title' name='title' error={errors.title}>
                    {(control) => (
                        <Input
                            {...control}
                            required
                            maxLength={200}
                            onChange={(event) => setTitle(event.target.value)}
                        />
                    )}
                </Field>
                <Field
                    label='Slug'
                    name='slug'
                    error={errors.slug}
                    hint='The address of the product page, /models/<slug>. It is fixed once the product is published. Leave empty to make it from the title.'
                >
                    {(control) => (
                        <Input
                            {...control}
                            maxLength={100}
                            placeholder={slugify(title) || 'e.g. cable-clip'}
                            className='font-mono'
                        />
                    )}
                </Field>
                <div className='flex flex-wrap items-center gap-3'>
                    <Button type='submit' disabled={navigation.state === 'submitting'}>
                        Create draft
                    </Button>
                    <FormStatus result={actionData} fields={Object.keys(errors)} />
                </div>
            </Form>
        </main>
    );
}
