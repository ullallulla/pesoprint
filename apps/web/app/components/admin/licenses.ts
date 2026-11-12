import { LICENSES, OWN_LICENSES, type License } from '@app/shared';

/** The licence picker's groups, in the order they are offered. Every licence appears exactly once. */
export const LICENSE_GROUPS: { label: string; ids: readonly License[] }[] = [
    { label: 'Shop licences (required for paid files)', ids: OWN_LICENSES },
    {
        label: 'Creative Commons',
        ids: ['cc_by', 'cc_by_sa', 'cc_by_nc', 'cc_by_nc_sa', 'cc_by_nd', 'cc_by_nc_nd', 'cc0'],
    },
    { label: 'Open source', ids: ['gpl', 'lgpl', 'bsd', 'ocl'] },
];

export const licenseName = (id: License) => LICENSES[id].name;
