import type { CatalogProduct, LibraryItem } from '@app/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, test } from 'vite-plus/test';

import ProductPage from './product';

const product: CatalogProduct = {
    id: '0190b6a0-0000-7000-8000-000000000101',
    slug: 'hook',
    title: 'Hook',
    description: '',
    category: null,
    cover: null,
    images: [],
    preview: null,
    files: [{ id: '0190b6a0-0000-7000-8000-000000000201', format: 'stl', filename: 'hook.stl', sizeBytes: 1_798_384 }],
    downloadCount: 1234,
    digitalPriceCents: 0,
    printBasePriceCents: 1290,
    license: 'cc_by_nc',
    size: null,
    printWeightG: null,
    printOptions: [],
    colourOptions: [],
    parcelSize: null,
    publishedAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T08:00:00.000Z',
};

function render(model: CatalogProduct, { inCart = false, printsInCart = 0, owned = null as LibraryItem | null } = {}) {
    // oxlint-disable-next-line typescript/no-explicit-any -- the stub supplies the route's props
    const Stub = createRoutesStub([
        { id: 'page', path: '/models/:slug', Component: ProductPage as any, loader: () => null },
    ]);
    return renderToStaticMarkup(
        <Stub
            initialEntries={['/models/hook']}
            hydrationData={{
                loaderData: {
                    page: { product: model, url: 'https://shop.test/models/hook', inCart, printsInCart, owned },
                },
            }}
        />,
    );
}

test('a free model has a working download link per file, which crawlers are asked not to follow', () => {
    const html = render(product);

    expect(html).toMatch(
        /<a href="\/models\/hook\/download\/0190b6a0-0000-7000-8000-000000000201" rel="nofollow"[^>]*aria-label="Download hook.stl"/,
    );
    expect(html).toContain('Downloaded 1,234 times.');
    expect(html).not.toContain('Free downloads open soon');
    // No active material to print in, so no print offer.
    expect(html).not.toContain('Printed for you');
});

const PLA = '0190b6a0-0000-7000-8000-000000000301';
const PETG = '0190b6a0-0000-7000-8000-000000000302';
const IN_BLUE = '0190b6a0-0000-7000-8000-000000000311';
const IN_BLACK = '0190b6a0-0000-7000-8000-000000000312';
const IN_BLACK_AND_ORANGE = '0190b6a0-0000-7000-8000-000000000313';
const printable: CatalogProduct = {
    ...product,
    parcelSize: 'M',
    printOptions: [
        { materialId: PLA, name: 'PLA', description: 'Easy to print.', priceCents: 1290 },
        { materialId: PETG, name: 'PETG', description: null, priceCents: 1590 },
    ],
    colourOptions: [
        // PLA is out of blue; PETG doesn't come in it.
        {
            id: IN_BLUE,
            name: 'Ocean blue',
            colours: [{ name: 'Ocean blue', hex: '#1f5fa8' }],
            materials: [{ materialId: PLA, inStock: false }],
        },
        {
            id: IN_BLACK,
            name: 'Black',
            colours: [{ name: 'Black', hex: '#1c1c1c' }],
            materials: [
                { materialId: PLA, inStock: true },
                { materialId: PETG, inStock: true },
            ],
        },
        {
            id: IN_BLACK_AND_ORANGE,
            name: 'Black / Orange',
            colours: [
                { name: 'Black', hex: '#1c1c1c' },
                { name: 'Orange', hex: '#f26b1d' },
            ],
            // PETG can't mix colours.
            materials: [{ materialId: PLA, inStock: true }],
        },
    ],
};

/** The attributes of the radio button with this value. */
const radio = (html: string, value: string) => html.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))?.[0] ?? '';

test('a print is ordered by picking a material, each with its price, and one of the colour options', () => {
    const html = render(printable);

    expect(html).toContain('Printed for you · from €12.90');
    expect(html).toContain('€15.90');
    expect(html).toContain('Easy to print.');
    expect(radio(html, PLA)).toContain('checked');
    // The first colour in stock is chosen; an out-of-stock one can't be.
    expect(radio(html, IN_BLACK)).toContain('checked');
    expect(radio(html, IN_BLUE)).toContain('disabled');
    expect(html).toContain('Ocean blue (out of stock)');
    // A multicolour option shows its colours in slices.
    expect(html).toContain('Black / Orange');
    expect(html).toContain('conic-gradient(#1c1c1c 0deg 180deg, #f26b1d 180deg 360deg)');
    expect(html).toContain('Chosen:</span> PLA, Black');
    expect(html).toMatch(/<button[^>]* type="submit"[^>]*value="add-print"[^>]*>.*Add to cart · €12.90<\/button>/s);
    expect(html).toContain('Ships in a medium parcel: €4.90 shipping.');
});

test('a model without colour options is ordered by material alone, in the colours shown', () => {
    const html = render({ ...printable, colourOptions: [] });
    expect(html).toContain('Printed to order in the material you choose.');
    expect(html).toContain('as shown in the photos.');
    expect(html).not.toContain('name="colourOptionId"');
    expect(html).toContain('Chosen:</span> PLA');
    expect(html).not.toMatch(/<button[^>]*value="add-print"[^>]*disabled=""/);
});

test('prints already in the cart are counted, with a link to the cart', () => {
    const html = render(printable, { printsInCart: 3 });
    expect(html).toContain('3 in your cart');
    expect(html).toContain('href="/cart"');
});

test('only the colour options the chosen material can print are shown', () => {
    // PETG first: it has black, but no blue and no mixed colours.
    const html = render({ ...printable, printOptions: [...printable.printOptions].reverse() });
    expect(radio(html, PETG)).toContain('checked');
    expect(radio(html, IN_BLACK)).toContain('checked');
    expect(html).not.toContain(`value="${IN_BLUE}"`);
    expect(html).not.toContain('Black / Orange');
    expect(html).toContain('Chosen:</span> PETG, Black');
});

test("a material that can print none of the model's colours can't be chosen", () => {
    const html = render({
        ...printable,
        colourOptions: printable.colourOptions.filter((option) => option.id === IN_BLACK_AND_ORANGE),
    });
    expect(radio(html, PETG)).toContain('disabled');
    expect(html).toContain('Not available in this model&#x27;s colours.');
});

test('a print with every colour option out of stock cannot be added', () => {
    const soldOut: CatalogProduct = {
        ...printable,
        colourOptions: printable.colourOptions.map((option) => ({
            ...option,
            materials: option.materials.map((entry) => ({ ...entry, inStock: false })),
        })),
    };
    const html = render(soldOut);
    expect(html).toContain('Every colour is out of stock in PLA right now.');
    expect(html).toMatch(/<button[^>]*value="add-print"[^>]*disabled=""/);
});

test('a paid file has no download link, but can be added to the cart', () => {
    const html = render({ ...product, digitalPriceCents: 450, license: 'standard_digital' });
    expect(html).not.toContain('/download/');
    expect(html).toContain('Model file · €4.50');
    // A plain form post, so it works before the page's JavaScript has loaded.
    expect(html).toMatch(/<form[^>]* action="\/models\/hook" method="post">/);
    expect(html).toMatch(/<button[^>]* type="submit" value="add-to-cart" name="intent">/);
    expect(html).not.toContain('href="/cart"');
});

test('a paid file already in the cart links to the cart instead', () => {
    const html = render({ ...product, digitalPriceCents: 450, license: 'standard_digital' }, { inCart: true });
    expect(html).toContain('In your cart');
    expect(html).toContain('href="/cart"');
    expect(html).not.toContain('value="add-to-cart"');
});

test('a bought model is in the library: its files download instead of "Add to cart"', () => {
    const paid = { ...product, digitalPriceCents: 450, license: 'standard_digital' } as const;
    const owned: LibraryItem = {
        productId: paid.id,
        slug: paid.slug,
        title: paid.title,
        cover: null,
        listed: true,
        orderId: '0190b6a0-0000-7000-8000-000000000901',
        acquiredAt: '2026-11-16T12:00:00.000Z',
        files: paid.files,
    };
    const html = render(paid, { inCart: true, owned });
    expect(html).toContain('In your library');
    expect(html).toContain('href="/library"');
    expect(html).toMatch(
        /<a href="\/models\/hook\/download\/0190b6a0-0000-7000-8000-000000000201" rel="nofollow"[^>]*aria-label="Download hook.stl"/,
    );
    expect(html).not.toContain('value="add-to-cart"');
    expect(html).not.toContain('In your cart');
});
