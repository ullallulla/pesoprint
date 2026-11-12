import { getEnv } from '~/env.server';
import { getSitemap } from '~/lib/catalog.server';
import { buildSitemap } from '~/lib/sitemap';

export async function loader() {
    const xml = buildSitemap(getEnv().SITE_URL, await getSitemap());
    return new Response(xml, {
        headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    });
}
