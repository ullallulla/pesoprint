import type {
    AdminCategory,
    AdminMaterial,
    AdminOrder,
    AdminOrderList,
    AdminProduct,
    AdminProductList,
    Colour,
} from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { describe, expect, test } from 'vite-plus/test';

import AdminCategories from './categories';
import AdminMaterials from './materials';
import AdminOrderPage from './order';
import AdminOrders from './orders';
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

const red: Colour = {
    id: '0190b6a0-0000-7000-8000-000000000311',
    name: 'Signal red',
    hex: '#cc0000',
    position: 0,
};
const black: Colour = {
    ...red,
    id: '0190b6a0-0000-7000-8000-000000000312',
    name: 'Galaxy black',
    hex: '#111111',
    position: 1,
};
const colours = [red, black];

/** PLA comes in both colours, black out of stock. Nylon only in red, and can't mix. */
const pla: AdminMaterial = {
    id: '0190b6a0-0000-7000-8000-000000000301',
    name: 'PLA',
    description: null,
    active: true,
    multicolour: true,
    position: 0,
    colours: [
        { colourId: red.id, name: red.name, hex: red.hex, inStock: true },
        { colourId: black.id, name: black.name, hex: black.hex, inStock: false },
    ],
};
const nylon: AdminMaterial = {
    ...pla,
    id: '0190b6a0-0000-7000-8000-000000000302',
    name: 'Nylon',
    active: false,
    multicolour: false,
    colours: [{ colourId: red.id, name: red.name, hex: red.hex, inStock: true }],
};
const materials = [pla, nylon];

const draft: AdminProduct = {
    id: '0190b6a0-0000-7000-8000-000000000001',
    slug: 'cable-clip',
    title: 'Cable Clip',
    status: 'draft',
    creatorId: 'user_1',
    categoryId: null,
    digitalPriceCents: 450,
    printBasePriceCents: null,
    parcelSize: null,
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
    printOptions: [],
    colourOptions: [],
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
    parcelSize: 'S',
    printOptions: [{ materialId: '0190b6a0-0000-7000-8000-000000000301', priceCents: 1290 }],
    colourOptions: [{ id: '0190b6a0-0000-7000-8000-000000000321', colourIds: [red.id, black.id] }],
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
    test('a preview is shown in the 3D viewer, which loads in the browser', () => {
        const withPreview: AdminProduct = {
            ...published,
            files: [
                ...published.files,
                {
                    id: '0190b6a0-0000-7000-8000-000000000202',
                    kind: 'preview',
                    url: 'https://assets.test/products/p/preview/1.glb',
                    format: 'glb',
                    filename: 'cable-clip-preview.glb',
                    sizeBytes: 90_000,
                    position: 0,
                },
            ],
        };
        const html = render('/admin/products/:id', EditProduct, {
            product: withPreview,
            categories,
            materials,
            colours,
        });

        // Server rendering only shows the placeholder; three.js never runs on the server.
        expect(html).toContain('Loading the 3D viewer…');
        expect(html).toContain('cable-clip-preview.glb');
        expect(html).toContain('Remake from STL');
        expect(html).not.toContain('No preview yet');
    });

    test('a draft lists what is missing before it can be published', () => {
        const html = render('/admin/products/:id', EditProduct, { product: draft, categories, materials, colours });

        expect(html).toContain('Before it can be published:');
        expect(html).toContain('Choose a category.');
        expect(html).toContain('A paid file must use the Standard Digital File or Commercial Use licence.');
        expect(html).toContain('Upload the file to download, or stop offering it.');
        expect(html).toMatch(/<button[^>]*value="publish"[^>]*disabled/);
        expect(html).toContain('Delete product');
        expect(html).not.toContain('Make from STL');
        // The form shows the saved values, prices in euros.
        expect(inputAttributes(html, 'fileOffer', 'paid')).toHaveProperty('checked');
        expect(html).toContain('value="4.50"');
        expect(html).toContain('Gadgets › Ham radio');
        expect(inputAttributes(html, 'slug')).not.toHaveProperty('readonly');
    });

    test('a published product locks its slug and must be archived before it can be deleted', () => {
        const html = render('/admin/products/:id', EditProduct, { product: published, categories, materials, colours });

        expect(inputAttributes(html, 'slug')).toHaveProperty('readonly');
        expect(html).toContain('href="/models/cable-clip"');
        expect(html).toContain('value="archive"');
        expect(html).toContain('Stop featuring');
        expect(html).not.toContain('Delete product');
        expect(html).toContain('To delete it, archive it first.');
        expect(inputAttributes(html, 'fileOffer', 'free')).toHaveProperty('checked');
        // Printed in PLA at €12.90; Nylon is offered to tick, marked inactive.
        expect(inputAttributes(html, `print:${pla.id}`)).toHaveProperty('checked');
        expect(inputAttributes(html, `printPrice:${pla.id}`).value).toBe('12.90');
        expect(inputAttributes(html, `print:${nylon.id}`)).not.toHaveProperty('checked');
        expect(html).toContain('Inactive');
        expect(html).toMatch(/<option value="S" selected="">Small \(S\)<\/option>/);
        // One multicolour option, its colours in order, then an empty row to add another.
        const menus = [...html.matchAll(/<select[^>]*name="colourOption:(\d)"[^>]*>(.*?)<\/select>/gs)].map(
            ([, row, options]) => [row, /<option value="([^"]*)" selected="">/.exec(options!)?.[1] ?? ''],
        );
        expect(menus).toEqual([
            ['0', red.id],
            ['0', black.id],
            ['0', ''],
            ['0', ''],
            ['1', ''],
            ['1', ''],
            ['1', ''],
            ['1', ''],
        ]);
        expect(html).toContain('Signal red / Galaxy black');
        // The model is printed in PLA, which is out of black.
        expect(html).toContain('In PLA (out of stock).');
        expect(html).toContain('cable-clip.stl');
        // An STL is there, so the preview can be made from it.
        expect(html).toContain('Make from STL');
        expect(html).toContain('No preview yet. Make one from the STL, or upload a .glb.');
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

test('the materials page lists each material with the colours it comes in, and their stock', () => {
    const petg: AdminMaterial = {
        ...pla,
        name: 'PETG',
        description: 'Tough and slightly flexible.',
        active: false,
        multicolour: false,
        colours: [{ colourId: red.id, name: red.name, hex: red.hex, inStock: false }],
    };
    const html = render('/admin/materials', AdminMaterials, { materials: [pla, petg], colours });

    expect(html).toContain('Inactive');
    expect(html).toContain('Single colour only');
    expect(html).toContain('2 colours, 1 in stock');
    expect(html).toContain('1 colour, 0 in stock');
    expect(html.indexOf('Signal red')).toBeLessThan(html.indexOf('Galaxy black'));
    expect(html).toContain('background:#cc0000');
    expect(html).toContain('Out of stock');
    expect(html).toContain('Mark in stock');
    expect(html).toContain('Mark out of stock');
    expect(html).toContain('aria-label="Remove Signal red from PETG"');
    // PLA has every colour; PETG can still be added in black.
    expect(html).toContain('Every colour');
    expect(html).toMatch(
        /<select[^>]*name="colourId"[^>]*><option value="0190b6a0-0000-7000-8000-000000000312">Galaxy black/,
    );
    expect(inputAttributes(html, 'multicolour')).toHaveProperty('checked');
    expect(html).toContain('Add colour');
    expect(html).toContain('Add material');
});

test('the materials page says when there are no materials or colours yet', () => {
    const html = render('/admin/materials', AdminMaterials, { materials: [], colours: [] });
    expect(html).toContain('No materials yet. Add the first one.');
    expect(html).toContain('No colours yet. Add the first one.');
});

const paidOrder: AdminOrder = {
    id: '0190b6a0-0000-7000-8000-0000a1b2c3d4',
    status: 'paid',
    email: 'maija@example.com',
    userId: 'user_1',
    currency: 'EUR',
    subtotalCents: 3030,
    shippingCents: 490,
    parcelSize: 'M',
    totalCents: 3520,
    shippingAddress: {
        name: 'Maija Meikäläinen',
        phone: '+358401234567',
        line1: 'Esimerkkikatu 1 A 2',
        line2: null,
        postalCode: '00100',
        city: 'Helsinki',
        country: 'FI',
    },
    carrier: null,
    trackingNumber: null,
    createdAt: '2026-11-17T09:58:00.000Z',
    paidAt: '2026-11-17T10:00:00.000Z',
    shippedAt: null,
    deliveredAt: null,
    items: [
        {
            productId: draft.id,
            type: 'print',
            title: 'Vase',
            print: { materialName: 'PLA', colourName: 'Signal red', colours: [{ name: red.name, hex: red.hex }] },
            quantity: 2,
            unitPriceCents: 1290,
        },
        { productId: draft.id, type: 'digital', title: 'Vase', print: null, quantity: 1, unitPriceCents: 450 },
    ],
};

const shippedOrder: AdminOrder = {
    ...paidOrder,
    id: '0190b6a0-0000-7000-8000-0000e5f6a7b8',
    status: 'shipped',
    carrier: 'Posti',
    trackingNumber: 'JJFI65432100',
    shippedAt: '2026-11-18T14:00:00.000Z',
};

describe('order queue', () => {
    test('lists each order with its buyer, prints, parcel, status and tracking', () => {
        const list: AdminOrderList = { orders: [paidOrder, shippedOrder], page: 1, pageSize: 25, total: 2 };
        const html = render('/admin/orders', AdminOrders, { list, filters: { status: 'open', q: undefined, page: 1 } });

        expect(html).toContain(`href="/admin/orders/${paidOrder.id}"`);
        expect(html).toContain('a1b2c3d4');
        expect(html).toContain('Maija Meikäläinen');
        expect(html).toContain('2 × Vase');
        expect(html).toContain('PLA, Signal red');
        expect(html).toContain('medium parcel · and a file');
        expect(html).toMatch(/Paid <time[^>]*>17 Nov 2026</);
        expect(html).toContain('JJFI65432100');
        expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*>To do</);
        expect(html).toContain('href="/admin/orders?status=shipped"');
        expect(html).toContain('oldest paid first');
    });

    test('says when there is nothing to do', () => {
        const list: AdminOrderList = { orders: [], page: 1, pageSize: 25, total: 0 };
        const html = render('/admin/orders', AdminOrders, { list, filters: { status: 'open', q: undefined, page: 1 } });
        expect(html).toContain('Nothing to print or ship.');
    });
});

describe('order page', () => {
    test('a paid order can start printing or be shipped straight away, and shows where it goes', () => {
        const html = render('/admin/orders/:id', AdminOrderPage, { order: paidOrder });

        expect(html).toContain('Start printing');
        expect(html).toContain('Mark as shipped');
        expect(inputAttributes(html, 'trackingNumber')).toHaveProperty('required');
        expect(html).toContain('<option value="Posti">');
        expect(html).toContain('Esimerkkikatu 1 A 2');
        expect(html).toContain('href="tel:+358401234567"');
        expect(html).toContain('href="mailto:maija@example.com"');
        expect(html).toContain('File, downloaded by the buyer');
        expect(html).toContain('Shipping (medium parcel)');
        expect(html).toContain('€35.20');
        expect(html).not.toContain('Mark as delivered');
    });

    test('a shipped order can be marked delivered, and its tracking number corrected', () => {
        const html = render('/admin/orders/:id', AdminOrderPage, { order: shippedOrder });

        expect(html).toContain('Mark as delivered');
        expect(html).toContain('Save shipment');
        expect(inputAttributes(html, 'trackingNumber')).toMatchObject({ value: 'JJFI65432100' });
        expect(inputAttributes(html, 'carrier')).toMatchObject({ value: 'Posti' });
        expect(html).not.toContain('Start printing');
    });

    test('a delivered order has nothing left to do', () => {
        const html = render('/admin/orders/:id', AdminOrderPage, {
            order: { ...shippedOrder, status: 'delivered', deliveredAt: '2026-11-20T10:00:00.000Z' },
        });

        expect(html).toContain('Delivered. Nothing more to do.');
        expect(html).toContain('20 Nov 2026');
        expect(html).not.toContain('name="intent"');
    });
});
