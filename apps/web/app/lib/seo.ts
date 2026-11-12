import type { MetaDescriptor } from 'react-router';

export const SITE_NAME = 'Pesoprint';

export interface PageSeo {
    title: string;
    description: string;
    /** Absolute URL of the page. */
    url: string;
    /** Absolute URL of the share image. */
    image?: string | null;
    type?: 'website' | 'product';
    /** Keep the page out of search results (e.g. search result pages). */
    noindex?: boolean;
}

/** Title, description, canonical link, Open Graph and Twitter tags for a page. */
export function pageMeta(seo: PageSeo): MetaDescriptor[] {
    const title = seo.title === SITE_NAME ? SITE_NAME : `${seo.title} – ${SITE_NAME}`;
    return [
        { title },
        { name: 'description', content: seo.description },
        { tagName: 'link', rel: 'canonical', href: seo.url },
        { property: 'og:site_name', content: SITE_NAME },
        { property: 'og:type', content: seo.type ?? 'website' },
        { property: 'og:title', content: seo.title },
        { property: 'og:description', content: seo.description },
        { property: 'og:url', content: seo.url },
        ...(seo.image ? [{ property: 'og:image', content: seo.image }] : []),
        { name: 'twitter:card', content: seo.image ? 'summary_large_image' : 'summary' },
        ...(seo.noindex ? [{ name: 'robots', content: 'noindex, follow' }] : []),
    ];
}
