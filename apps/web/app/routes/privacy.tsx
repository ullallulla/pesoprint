import { LegalPage } from '~/components/legal-page';
import { fillLegalText } from '~/lib/legal';
import { pageMeta } from '~/lib/seo';
import { absoluteUrl } from '~/lib/site.server';

import text from '../content/privacy.md?raw';
import type { Route } from './+types/privacy';

const TITLE = 'Privacy policy';
const content = fillLegalText(text);

export function loader() {
    return { url: absoluteUrl('/privacy') };
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
    pageMeta({
        title: TITLE,
        description: 'How Pesoprint handles your personal data, which cookies it uses, and your rights.',
        url: loaderData?.url ?? '/privacy',
    });

export default function PrivacyPage() {
    return <LegalPage title={TITLE}>{content}</LegalPage>;
}
