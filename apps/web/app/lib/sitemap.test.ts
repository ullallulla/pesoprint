import { expect, test } from 'vite-plus/test';

import { buildRobots, buildSitemap } from './sitemap';

test('sitemap lists home, the listing, categories and products with their last change date', () => {
    const xml = buildSitemap('https://pesoprint.test', {
        categories: [{ slug: 'ham-radio' }],
        products: [{ slug: 'ft5-table-stand', updatedAt: '2026-11-10T08:30:00.000Z' }],
    });

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<url><loc>https://pesoprint.test/</loc></url>');
    expect(xml).toContain('<url><loc>https://pesoprint.test/models</loc></url>');
    expect(xml).toContain('<url><loc>https://pesoprint.test/categories/ham-radio</loc></url>');
    expect(xml).toContain(
        '<url><loc>https://pesoprint.test/models/ft5-table-stand</loc><lastmod>2026-11-10</lastmod></url>',
    );
});

test('sitemap escapes XML special characters', () => {
    const xml = buildSitemap('https://pesoprint.test/?a=1&b=2', { categories: [], products: [] });
    expect(xml).toContain('https://pesoprint.test/?a=1&amp;b=2/models');
});

test('robots.txt keeps crawlers out of the admin and points at the sitemap', () => {
    expect(buildRobots('https://pesoprint.test')).toBe(
        'User-agent: *\nDisallow: /admin\n\nSitemap: https://pesoprint.test/sitemap.xml\n',
    );
});
