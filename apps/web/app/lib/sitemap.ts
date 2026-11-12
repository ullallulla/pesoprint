import type { CatalogSitemap } from '@app/shared';

const escapeXml = (value: string) =>
    value.replace(
        /[<>&'"]/g,
        (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]!,
    );

/** sitemap.xml for the public pages: home, the model listing, categories with models, and every published model. */
export function buildSitemap(siteUrl: string, entries: CatalogSitemap): string {
    const urls: { loc: string; lastmod?: string }[] = [
        { loc: `${siteUrl}/` },
        { loc: `${siteUrl}/models` },
        ...entries.categories.map((category) => ({
            loc: `${siteUrl}/categories/${encodeURIComponent(category.slug)}`,
        })),
        ...entries.products.map((product) => ({
            loc: `${siteUrl}/models/${encodeURIComponent(product.slug)}`,
            lastmod: product.updatedAt.slice(0, 10),
        })),
    ];
    const body = urls
        .map(
            ({ loc, lastmod }) =>
                `  <url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`,
        )
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function buildRobots(siteUrl: string): string {
    return [
        'User-agent: *',
        'Disallow: /admin',
        'Disallow: /models/*/download/',
        '',
        `Sitemap: ${siteUrl}/sitemap.xml`,
        '',
    ].join('\n');
}
