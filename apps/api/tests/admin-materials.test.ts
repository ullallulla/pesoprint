import { fileURLToPath } from 'node:url';

import {
    adminMaterialListSchema,
    apiErrorSchema,
    colourSchema,
    materialSchema,
    type Colour,
    type Material,
} from '@app/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { colours, materials, productMaterials } from '../src/db/schema.ts';
import { createMaterialsService } from '../src/services/materials.ts';
import { bearer, buildApp, tokens } from './helpers.ts';

const SOME_ID = '0190a6d2-3b7e-7000-8000-000000000000';

describe('admin material routes: auth and validation', () => {
    const app = buildApp();

    test.each([
        ['GET', '/api/admin/materials'],
        ['POST', '/api/admin/materials'],
        ['PATCH', `/api/admin/materials/${SOME_ID}`],
        ['DELETE', `/api/admin/materials/${SOME_ID}`],
        ['POST', `/api/admin/materials/${SOME_ID}/colours`],
        ['PATCH', `/api/admin/colours/${SOME_ID}`],
        ['DELETE', `/api/admin/colours/${SOME_ID}`],
    ])('%s %s is admin only', async (method, path) => {
        expect((await app.request(path, { method })).status).toBe(401);
        expect((await app.request(path, { method, ...bearer(tokens.customer) })).status).toBe(403);
    });

    test('400 with field issues for an invalid colour', async () => {
        const res = await app.request(`/api/admin/materials/${SOME_ID}/colours`, {
            method: 'POST',
            headers: { ...bearer(tokens.admin).headers, 'content-type': 'application/json' },
            body: JSON.stringify({ name: '', hex: 'blue' }),
        });

        expect(res.status).toBe(400);
        const { error } = apiErrorSchema.parse(await res.json());
        expect(error.issues?.map((issue) => issue.path).sort()).toEqual(['hex', 'name']);
    });
});

const url = process.env.TEST_DATABASE_URL;

// Runs against a real Postgres. Start it with `vp run db:up` (local) — CI provides one as a service.
describe.skipIf(!url)('admin material routes (integration)', () => {
    const { db, pool } = createDatabase(url ?? '');
    const app = buildApp({ materials: createMaterialsService(db) });

    function call(method: string, path: string, body?: unknown) {
        return app.request(`/api/admin${path}`, {
            method,
            headers: { ...bearer(tokens.admin).headers, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    }

    async function createMaterial(body: Record<string, unknown>): Promise<Material> {
        const res = await call('POST', '/materials', body);
        expect(res.status).toBe(201);
        return materialSchema.parse(await res.json());
    }

    async function addColour(materialId: string, body: Record<string, unknown>): Promise<Colour> {
        const res = await call('POST', `/materials/${materialId}/colours`, body);
        expect(res.status).toBe(201);
        return colourSchema.parse(await res.json());
    }

    async function list() {
        const res = await call('GET', '/materials');
        expect(res.status).toBe(200);
        return adminMaterialListSchema.parse(await res.json()).materials;
    }

    async function expectError(res: Response, status: number) {
        expect(res.status).toBe(status);
        return apiErrorSchema.parse(await res.json()).error;
    }

    const reset = async () => {
        // Models' print options keep materials from being deleted.
        await db.delete(productMaterials);
        await db.delete(materials);
    };

    beforeAll(async () => {
        await runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
        await reset();
    });

    beforeEach(reset);

    afterAll(async () => {
        await reset();
        await pool.end();
    });

    test('creates a material with defaults, and lists materials and colours in position order', async () => {
        const petg = await createMaterial({ name: 'PETG', position: 1 });
        const pla = await createMaterial({ name: 'PLA', description: 'Easy to print.' });
        expect(pla).toMatchObject({ name: 'PLA', description: 'Easy to print.', active: true, position: 0 });

        await addColour(pla.id, { name: 'White', hex: '#FFFFFF', position: 1 });
        await addColour(pla.id, { name: 'Black', hex: '#000000' });
        await addColour(petg.id, { name: 'Orange', hex: '#ff8800' });

        const all = await list();
        expect(all.map((m) => [m.name, m.colours.map((c) => [c.name, c.hex, c.inStock])])).toEqual([
            [
                'PLA',
                [
                    ['Black', '#000000', true],
                    ['White', '#ffffff', true],
                ],
            ],
            ['PETG', [['Orange', '#ff8800', true]]],
        ]);
    });

    test('names are unique regardless of case: materials overall, colours within their material', async () => {
        const pla = await createMaterial({ name: 'PLA' });
        const petg = await createMaterial({ name: 'PETG' });
        await addColour(pla.id, { name: 'Black', hex: '#000000' });

        const material = await expectError(await call('POST', '/materials', { name: 'pla' }), 409);
        expect(material.issues).toEqual([{ path: 'name', message: 'There is already a material called “pla”.' }]);
        await expectError(await call('PATCH', `/materials/${petg.id}`, { name: 'Pla' }), 409);

        const colour = await expectError(
            await call('POST', `/materials/${pla.id}/colours`, { name: 'BLACK', hex: '#111111' }),
            409,
        );
        expect(colour.issues?.[0]?.path).toBe('name');
        // The same name in another material is fine.
        await addColour(petg.id, { name: 'Black', hex: '#000000' });
    });

    test('updates only the fields sent: hide a material, mark a colour out of stock', async () => {
        const pla = await createMaterial({ name: 'PLA', description: 'Easy to print.' });
        const black = await addColour(pla.id, { name: 'Black', hex: '#000000' });

        const hidden = await call('PATCH', `/materials/${pla.id}`, { active: false });
        expect(materialSchema.parse(await hidden.json())).toMatchObject({
            name: 'PLA',
            description: 'Easy to print.',
            active: false,
        });

        const soldOut = await call('PATCH', `/colours/${black.id}`, { inStock: false });
        expect(colourSchema.parse(await soldOut.json())).toMatchObject({ name: 'Black', inStock: false });

        const cleared = await call('PATCH', `/materials/${pla.id}`, { description: null });
        expect(materialSchema.parse(await cleared.json()).description).toBeNull();
    });

    test('404 for a material or colour that does not exist', async () => {
        const responses = await Promise.all([
            call('PATCH', `/materials/${SOME_ID}`, { active: false }),
            call('PATCH', `/materials/${SOME_ID}`, {}),
            call('DELETE', `/materials/${SOME_ID}`),
            call('POST', `/materials/${SOME_ID}/colours`, { name: 'Red', hex: '#ff0000' }),
            call('PATCH', `/colours/${SOME_ID}`, { inStock: false }),
            call('DELETE', `/colours/${SOME_ID}`),
        ]);
        expect(responses.map((res) => res.status)).toEqual([404, 404, 404, 404, 404, 404]);
    });

    test('deletes a colour, and a material together with its colours', async () => {
        const pla = await createMaterial({ name: 'PLA' });
        const black = await addColour(pla.id, { name: 'Black', hex: '#000000' });
        await addColour(pla.id, { name: 'White', hex: '#ffffff' });

        expect((await call('DELETE', `/colours/${black.id}`)).status).toBe(204);
        expect((await list())[0]?.colours.map((c) => c.name)).toEqual(['White']);

        expect((await call('DELETE', `/materials/${pla.id}`)).status).toBe(204);
        expect(await list()).toEqual([]);
        expect(await db.select().from(colours)).toEqual([]);
    });
});
