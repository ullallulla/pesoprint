import { getEnv } from '~/env.server';
import { buildRobots } from '~/lib/sitemap';

export function loader() {
    return new Response(buildRobots(getEnv().SITE_URL), {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' },
    });
}
