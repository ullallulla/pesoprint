import { z } from 'zod';

/**
 * Licences a model can be published under, modelled on Printables: one licence per model,
 * picked from a fixed list. The API's `license` database enum is built from this tuple,
 * so adding a licence here needs a migration (`vp run db:generate`).
 *
 * Versions are pinned by the metadata below. If a new version is needed (e.g. CC 5.0),
 * add a new id rather than changing what an existing one means.
 */
export const LICENSE_IDS = [
    'cc_by',
    'cc_by_sa',
    'cc_by_nc',
    'cc_by_nc_sa',
    'cc_by_nd',
    'cc_by_nc_nd',
    'cc0',
    'gpl',
    'lgpl',
    'bsd',
    'ocl',
    'standard_digital',
    'commercial',
] as const;

export const licenseSchema = z.enum(LICENSE_IDS);
export type License = z.infer<typeof licenseSchema>;

/**
 * The shop's own licences (legal text written before launch, M6).
 * Paid files must use one of these: selling a file under CC or GPL would charge
 * for something the buyer could legally get for free elsewhere.
 */
export const OWN_LICENSES = ['standard_digital', 'commercial'] as const satisfies readonly License[];

export interface LicenseInfo {
    name: string;
    /** Full licence text. `null` until the page or a verified link exists. */
    url: string | null;
}

export const LICENSES: Record<License, LicenseInfo> = {
    cc_by: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    cc_by_sa: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    cc_by_nc: { name: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
    cc_by_nc_sa: { name: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' },
    cc_by_nd: { name: 'CC BY-ND 4.0', url: 'https://creativecommons.org/licenses/by-nd/4.0/' },
    cc_by_nc_nd: { name: 'CC BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/' },
    cc0: { name: 'CC0 1.0 (public domain)', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    gpl: { name: 'GNU GPL v3', url: 'https://www.gnu.org/licenses/gpl-3.0.html' },
    lgpl: { name: 'GNU LGPL v3', url: 'https://www.gnu.org/licenses/lgpl-3.0.html' },
    bsd: { name: 'BSD 3-Clause', url: 'https://opensource.org/license/bsd-3-clause' },
    ocl: { name: 'Open Community License 1.1', url: null },
    standard_digital: { name: 'Standard Digital File License', url: null },
    commercial: { name: 'Commercial Use License', url: null },
};

export function isOwnLicense(license: License): boolean {
    return (OWN_LICENSES as readonly License[]).includes(license);
}
