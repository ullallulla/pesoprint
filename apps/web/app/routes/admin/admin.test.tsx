import type { AdminCategory, AdminProduct, AdminProductList } from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { describe, expect, test } from 'vite-plus/test';

import AdminCategories from './categories';
import EditProduct from './product-edit';
import AdminProducts from './products';

// Server-renders the admin pages with loader data shaped like the API's, the way the first page load does.

const gadgets: AdminCategory = {
    id: '0190b6a0-0000-7000-8000-00000000000a',
    slug: 'gadgets',
    name: 'Gadgets',
    description: null,
    parentId: null,
    position: 0,
    productCount: 0,
};
const ham: AdminCategory = {
    ...gadgets,
    id: '0190b6a0-0000-7000-8000-00000000000b',
    slug: 'ham-radio',
    name: 'Ham radio',
    parentId: gadgets.id,
    productCount: 3,
};
const categories = [gadgets, ham];

const draft: AdminProduct = {
    id: '0190b6a0-0000-7000-8000-000000000001',
    slug: 'cable-clip',
    title: 'Cable Clip',
    status: 'draft',
    creatorId: 'user_1',
    categoryId: null,
    digitalPriceCents: 450,
    printBasePriceCents: null,
    license: 'cc_by',
    sizeXMm: 20,
    sizeYMm: null,
    sizeZMm: null,
    printWeightG: null,
    featuredAt: null,
    publishedAt: null,
    createdAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-11T08:00:00.000Z',
    description: 'A **clip**.',
    images: [
        {
            id: '0190b6a0-0000-7000-8000-000000000101',
            url: 'https://assets.test/products/p/images/1.webp',
            alt: 'Photo of the Cable Clip',
            width: 800,
            height: 600,
            sizeBytes: 1000,
            position: 0,
        },
    ],
    files: [],
};

const published: AdminProduct = {
    ...draft,
    status: 'published',
    categoryId: ham.id,
    digitalPriceCents: 0,
    printBasePriceCents: 1290,
    publishedAt: '2026-11-11T09:00:00.000Z',
    featuredAt: '2026-11-11T10:00:00.000Z',
    files: [
        {
            id: '0190b6a0-0000-7000-8000-000000000201',
            kind: 'download',
            url: null,
            format: 'stl',
            filename: 'cable-clip.stl',
            sizeBytes: 2_500_000,
            position: 0,
        },
    ],
};

// The route components take React Router's generated props; the stub provides them.
// oxlint-disable-next-line typescript/no-explicit-any
type RouteComponent = React.ComponentType<any>;

function render(path: string, Component: RouteComponent, loaderData: unknown) {
    const Stub = createRoutesStub([{ id: 'page', path, Component, loader: () => null }]);
    return renderToStaticMarkup(
        <Stub initialEntries={[path.replace(':id', draft.id)]} hydrationData={{ loaderData: { page: loaderData } }} />,
    );
}

/** The attributes of the `<input>` with this name (and value, for radios), e.g. `{ checked: '' }`. */
function inputAttributes(html: string, name: string, value?: string): Record<string, string> {
    for (const [tag] of html.matchAll(/<input[^>]*>/g)) {
        const attributes = Object.fromEntries(
            [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, val]) => [key!.toLowerCase(), val!]),
        );
        if (attributes.name === name && (value === undefined || attributes.value === value)) return attributes;
    }
    throw new Error(`No input named ${name}`);
}

describe('product editor', () => {
    test('a draft lists what is missing before it can be published', () => {
        const html = render('/admin/products/:id', EditProduct, { product: draft, categories });

        expect(html).toContain('Before it can be published:');
        expect(html).toContain('Choose a category.');
        expect(html).toContain('A paid file must use the Standard Digital File or Commercial Use licence.');
        expect(html).toContain('Upload the file to download, or stop offering it.');
        expect(html).toMatch(/<button[^>]*value="publish"[^>]*disabled/);
        expect(html).toContain('Delete product');
        // The form shows the saved values, prices in euros.
        expect(inputAttributes(html, 'fileOffer', 'paid')).toHaveProperty('checked');
        expect(html).toContain('value="4.50"');
        expect(html).toContain('Gadgets › Ham radio');
        expect(inputAttributes(html, 'slug')).not.toHaveProperty('readonly');
    });

    test('a published product locks its slug and must be archived before it can be deleted', () => {
        const html = render('/admin/products/:id', EditProduct, { product: published, categories });

        expect(inputAttributes(html, 'slug')).toHaveProperty('readonly');
        expect(html).toContain('href="/models/cable-clip"');
        expect(html).toContain('value="archive"');
        expect(html).toContain('Stop featuring');
        expect(html).not.toContain('Delete product');
        expect(html).toContain('To delete it, archive it first.');
        expect(inputAttributes(html, 'fileOffer', 'free')).toHaveProperty('checked');
        expect(html).toContain('cable-clip.stl');
        expect(html).toContain('2.4 MB');
    });
});

test('the category manager nests subcategories and only lets empty ones be deleted', () => {
    const html = render('/admin/categories', AdminCategories, { categories });

    expect(html.indexOf('Gadgets')).toBeLessThan(html.indexOf('Ham radio'));
    expect(html).toContain('3 products');
    expect(html).toContain('Move its subcategories to another category first.');
    expect(html).toContain('Move its products to another category first.');
});

test('the product list shows status, category and offers', () => {
    const list: AdminProductList = { products: [published, draft], page: 1, pageSize: 25, total: 2 };
    const html = render('/admin/products', AdminProducts, {
        list,
        categories,
        filters: { status: undefined, q: undefined, page: 1 },
    });

    expect(html).toContain(`href="/admin/products/${draft.id}"`);
    expect(html).toContain('Published');
    expect(html).toContain('Featured');
    expect(html).toContain('Gadgets › Ham radio');
    expect(html).toContain('Print from €12.90');
    expect(html).toContain('File €4.50');
});
