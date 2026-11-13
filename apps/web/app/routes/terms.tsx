import { LegalPage } from '~/components/legal-page';
import { fillLegalText } from '~/lib/legal';
import { pageMeta } from '~/lib/seo';
import { absoluteUrl } from '~/lib/site.server';

import text from '../content/terms.md?raw';
import type { Route } from './+types/terms';

const TITLE = 'Terms of use';
const content = fillLegalText(text);

export function loader() {
    return { url: absoluteUrl('/terms') };
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
    pageMeta({
        title: TITLE,
        description: 'The terms for using the Pesoprint website and downloading models.',
        url: loaderData?.url ?? '/terms',
    });

export default function TermsPage() {
    return <LegalPage title={TITLE}>{content}</LegalPage>;
}
