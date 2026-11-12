import type { ProductStatus } from '@app/shared';
import { Star } from 'lucide-react';

import { Badge } from '~/components/ui/badge';

const STATUS_LABELS: Record<ProductStatus, string> = {
    draft: 'Draft',
    published: 'Published',
    archived: 'Archived',
};

export function StatusBadge({ status }: { status: ProductStatus }) {
    return (
        <Badge variant={status === 'published' ? 'default' : status === 'draft' ? 'secondary' : 'outline'}>
            {STATUS_LABELS[status]}
        </Badge>
    );
}

export function FeaturedBadge() {
    return (
        <Badge variant='outline'>
            <Star aria-hidden className='fill-current' />
            Featured
        </Badge>
    );
}
