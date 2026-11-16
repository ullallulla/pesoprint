import { fileURLToPath } from 'node:url';

import {
    adminColourListSchema,
    adminMaterialListSchema,
    apiErrorSchema,
    colourSchema,
    materialColourSchema,
    materialSchema,
    type Colour,
    type Material,
} from '@app/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test';

import { createDatabase, runMigrations } from '../src/db/client.ts';
import { colours, materials, productColourOptions, productMaterials } from '../src/db/schema.ts';
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
        ['GET', '/api/admin/colours'],
        ['POST', '/api/admin/colours'],
        ['PATCH', `/api/admin/colours/${SOME_ID}`],
        ['DELETE', `/api/admin/colours/${SOME_ID}`],
        ['PUT', `/api/admin/materials/${SOME_ID}/colours/${SOME_ID}`],
        ['DELETE', `/api/admin/materials/${SOME_ID}/colours/${SOME_ID}`],
    ])('%s %s is admin only', async (method, path) => {
        expect((await app.request(path, { method })).status).toBe(401);
        expect((await app.request(path, { method, ...bearer(tokens.customer) })).status).toBe(403);
    });

    test('400 with field issues for an invalid colour', async () => {
        const res = await app.request('/api/admin/colours', {
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

    async function addColour(body: Record<string, unknown>): Promise<Colour> {
        const res = await call('POST', '/colours', body);
        expect(res.status).toBe(201);
        return colourSchema.parse(await res.json());
    }

    async function list() {
        const res = await call('GET', '/materials');
        expect(res.status).toBe(200);
        return adminMaterialListSchema.parse(await res.json()).materials;
    }

    async function listColours() {
        const res = await call('GET', '/colours');
        expect(res.status).toBe(200);
        return adminColourListSchema.parse(await res.json()).colours;
    }

    async function expectError(res: Response, status: number) {
        expect(res.status).toBe(status);
        return apiErrorSchema.parse(await res.json()).error;
    }

    const reset = async () => {
        // Models' print and colour options keep materials and colours from being deleted.
        await db.delete(productMaterials);
        await db.delete(productColourOptions);
        await db.delete(materials);
        await db.delete(colours);
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

    test('creates materials and colours with defaults, and lists each in position order', async () => {
        await createMaterial({ name: 'PETG', position: 1 });
        const pla = await createMaterial({ name: 'PLA', description: 'Easy to print.' });
        expect(pla).toMatchObject({
            name: 'PLA',
            description: 'Easy to print.',
            active: true,
            multicolour: true,
            position: 0,
        });

        await addColour({ name: 'White', hex: '#FFFFFF', position: 1 });
        await addColour({ name: 'Black', hex: '#000000' });
        await addColour({ name: 'Orange', hex: '#ff8800', position: 2 });

        expect((await list()).map((m) => m.name)).toEqual(['PLA', 'PETG']);
        expect((await listColours()).map((c) => [c.name, c.hex])).toEqual([
            ['Black', '#000000'],
            ['White', '#ffffff'],
            ['Orange', '#ff8800'],
        ]);
    });

    test('names are unique regardless of case, among materials and among colours', async () => {
        await createMaterial({ name: 'PLA' });
        const petg = await createMaterial({ name: 'PETG' });
        const black = await addColour({ name: 'Black', hex: '#000000' });
        const white = await addColour({ name: 'White', hex: '#ffffff' });

        const material = await expectError(await call('POST', '/materials', { name: 'pla' }), 409);
        expect(material.issues).toEqual([{ path: 'name', message: 'There is already a material called “pla”.' }]);
        await expectError(await call('PATCH', `/materials/${petg.id}`, { name: 'Pla' }), 409);

        const colour = await expectError(await call('POST', '/colours', { name: 'BLACK', hex: '#111111' }), 409);
        expect(colour.issues).toEqual([{ path: 'name', message: 'There is already a colour called “BLACK”.' }]);
        await expectError(await call('PATCH', `/colours/${white.id}`, { name: 'black' }), 409);
        // A material and a colour may share a name.
        await addColour({ name: 'PLA', hex: '#123456' });
        expect(black.name).toBe('Black');
    });

    test('updates only the fields sent: hide a material, stop it mixing colours, rename a colour', async () => {
        const pla = await createMaterial({ name: 'PLA', description: 'Easy to print.' });
        const black = await addColour({ name: 'Black', hex: '#000000' });

        const hidden = await call('PATCH', `/materials/${pla.id}`, { active: false, multicolour: false });
        expect(materialSchema.parse(await hidden.json())).toMatchObject({
            name: 'PLA',
            description: 'Easy to print.',
            active: false,
            multicolour: false,
        });

        const renamed = await call('PATCH', `/colours/${black.id}`, { name: 'Galaxy black' });
        expect(colourSchema.parse(await renamed.json())).toMatchObject({ name: 'Galaxy black', hex: '#000000' });

        const cleared = await call('PATCH', `/materials/${pla.id}`, { description: null });
        expect(materialSchema.parse(await cleared.json()).description).toBeNull();
    });

    test('404 for a material or colour that does not exist', async () => {
        const responses = await Promise.all([
            call('PATCH', `/materials/${SOME_ID}`, { active: false }),
            call('PATCH', `/materials/${SOME_ID}`, {}),
            call('DELETE', `/materials/${SOME_ID}`),
            call('PATCH', `/colours/${SOME_ID}`, { name: 'Red' }),
            call('DELETE', `/colours/${SOME_ID}`),
        ]);
        expect(responses.map((res) => res.status)).toEqual([404, 404, 404, 404, 404]);
    });

    test('a material lists the colours you have it in, each in stock or not', async () => {
        const pla = await createMaterial({ name: 'PLA' });
        const petg = await createMaterial({ name: 'PETG', position: 1 });
        const white = await addColour({ name: 'White', hex: '#ffffff', position: 1 });
        const black = await addColour({ name: 'Black', hex: '#000000' });

        const added = await call('PUT', `/materials/${pla.id}/colours/${white.id}`, {});
        expect(added.status).toBe(200);
        expect(materialColourSchema.parse(await added.json())).toEqual({
            colourId: white.id,
            name: 'White',
            hex: '#ffffff',
            inStock: true,
        });
        await call('PUT', `/materials/${pla.id}/colours/${black.id}`, { inStock: false });
        await call('PUT', `/materials/${petg.id}/colours/${black.id}`, {});
        // Putting it again changes its stock.
        await call('PUT', `/materials/${pla.id}/colours/${white.id}`, { inStock: false });

        const stock = (await list()).map((m) => [m.name, m.colours.map((c) => [c.name, c.inStock])]);
        expect(stock).toEqual([
            [
                'PLA',
                [
                    ['Black', false],
                    ['White', false],
                ],
            ],
            ['PETG', [['Black', true]]],
        ]);

        expect((await call('DELETE', `/materials/${pla.id}/colours/${white.id}`)).status).toBe(204);
        expect((await call('DELETE', `/materials/${pla.id}/colours/${white.id}`)).status).toBe(404);
        expect((await list())[0]!.colours.map((c) => c.name)).toEqual(['Black']);
        expect((await call('PUT', `/materials/${pla.id}/colours/${SOME_ID}`, {})).status).toBe(404);
        expect((await call('PUT', `/materials/${SOME_ID}/colours/${black.id}`, {})).status).toBe(404);

        // Deleting a colour takes it off every material.
        expect((await call('DELETE', `/colours/${black.id}`)).status).toBe(204);
        expect((await list()).map((m) => m.colours)).toEqual([[], []]);
    });

    test('deletes a material and a colour', async () => {
        const pla = await createMaterial({ name: 'PLA' });
        const black = await addColour({ name: 'Black', hex: '#000000' });
        await addColour({ name: 'White', hex: '#ffffff' });

        expect((await call('DELETE', `/colours/${black.id}`)).status).toBe(204);
        expect((await listColours()).map((c) => c.name)).toEqual(['White']);

        expect((await call('DELETE', `/materials/${pla.id}`)).status).toBe(204);
        expect(await list()).toEqual([]);
    });
});
