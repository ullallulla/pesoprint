import type {
    AdminMaterial,
    Colour,
    CreateColour,
    CreateMaterial,
    Material,
    MaterialColour,
    SetMaterialColour,
    UpdateColour,
    UpdateMaterial,
} from '@app/shared';
import { and, asc, eq } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { isPgError, PgErrorCode } from '../db/errors.ts';
import { colours, materialColours, materials } from '../db/schema.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { definedFields } from '../lib/patch.ts';
import { refreshPrintPrices } from './products.ts';

export interface MaterialsService {
    /** Every material, active or not, with the colours you have it in. Both ordered by position then name. */
    list(): Promise<AdminMaterial[]>;
    create(input: CreateMaterial): Promise<Material>;
    /**
     * Switching `active` also updates the "Print from €X" price of the models that use the material.
     * Refused (409) if that would leave a published model with nothing to sell.
     */
    update(id: string, input: UpdateMaterial): Promise<Material>;
    /** Refused (409) once anything refers to the material. */
    remove(id: string): Promise<void>;
    /** Every colour, ordered by position then name. */
    listColours(): Promise<Colour[]>;
    addColour(input: CreateColour): Promise<Colour>;
    updateColour(id: string, input: UpdateColour): Promise<Colour>;
    /** Refused (409) once a model offers the colour. Materials stop coming in it. */
    removeColour(id: string): Promise<void>;
    /** You have the material in this colour (in stock or not). Adds it, or changes its stock. */
    setMaterialColour(materialId: string, colourId: string, input: SetMaterialColour): Promise<MaterialColour>;
    /** You no longer have the material in this colour. */
    removeMaterialColour(materialId: string, colourId: string): Promise<void>;
}

const materialColumns = {
    id: materials.id,
    name: materials.name,
    description: materials.description,
    active: materials.active,
    multicolour: materials.multicolour,
    position: materials.position,
};

const colourColumns = {
    id: colours.id,
    name: colours.name,
    hex: colours.hex,
    position: colours.position,
};

/** Names are unique regardless of case: a material among materials, a colour among colours. */
function rethrowNameTaken(error: unknown, name: string | undefined): never {
    if (isPgError(error, PgErrorCode.uniqueViolation, 'materials_name_unique')) {
        const message = `There is already a material called “${name}”.`;
        throw conflict(message, [{ path: 'name', message }]);
    }
    if (isPgError(error, PgErrorCode.uniqueViolation, 'colours_name_unique')) {
        const message = `There is already a colour called “${name}”.`;
        throw conflict(message, [{ path: 'name', message }]);
    }
    throw error;
}

/** Something (a model's print or colour options, an order) still refers to the row. */
function rethrowInUse(error: unknown, message: string): never {
    if (isPgError(error, PgErrorCode.restrictViolation) || isPgError(error, PgErrorCode.foreignKeyViolation)) {
        throw conflict(message);
    }
    throw error;
}

export function createMaterialsService(db: Database): MaterialsService {
    return {
        async list() {
            const [materialRows, filaments] = await Promise.all([
                db.select(materialColumns).from(materials).orderBy(asc(materials.position), asc(materials.name)),
                db
                    .select({
                        materialId: materialColours.materialId,
                        colourId: colours.id,
                        name: colours.name,
                        hex: colours.hex,
                        inStock: materialColours.inStock,
                    })
                    .from(materialColours)
                    .innerJoin(colours, eq(colours.id, materialColours.colourId))
                    .orderBy(asc(colours.position), asc(colours.name)),
            ]);
            return materialRows.map((material) => ({
                ...material,
                colours: filaments
                    .filter((filament) => filament.materialId === material.id)
                    .map(({ colourId, name, hex, inStock }) => ({ colourId, name, hex, inStock })),
            }));
        },

        async create(input) {
            try {
                const [created] = await db.insert(materials).values(input).returning(materialColumns);
                return created!;
            } catch (error) {
                rethrowNameTaken(error, input.name);
            }
        },

        async update(id, input) {
            const changes = definedFields(input);
            try {
                return await db.transaction(async (tx) => {
                    const [updated] =
                        Object.keys(changes).length === 0
                            ? await tx.select(materialColumns).from(materials).where(eq(materials.id, id))
                            : await tx
                                  .update(materials)
                                  .set(changes)
                                  .where(eq(materials.id, id))
                                  .returning(materialColumns);
                    if (!updated) throw notFound('Material not found.');
                    // Switching it on or off changes the "Print from €X" price of the models that use it.
                    if (changes.active !== undefined) await refreshPrintPrices(tx, id);
                    return updated;
                });
            } catch (error) {
                if (isPgError(error, PgErrorCode.checkViolation, 'products_publishable')) {
                    const message =
                        'Some published models can only be printed in this material and have no file to sell. ' +
                        'Give them another material, or archive them, first.';
                    throw conflict(message, [{ path: 'active', message }]);
                }
                rethrowNameTaken(error, input.name);
            }
        },

        async remove(id) {
            try {
                const deleted = await db.delete(materials).where(eq(materials.id, id)).returning({ id: materials.id });
                if (deleted.length === 0) throw notFound('Material not found.');
            } catch (error) {
                rethrowInUse(error, 'This material is in use. Make it inactive instead, so buyers no longer see it.');
            }
        },

        listColours() {
            return db.select(colourColumns).from(colours).orderBy(asc(colours.position), asc(colours.name));
        },

        async addColour(input) {
            try {
                const [created] = await db.insert(colours).values(input).returning(colourColumns);
                return created!;
            } catch (error) {
                rethrowNameTaken(error, input.name);
            }
        },

        async updateColour(id, input) {
            const changes = definedFields(input);
            try {
                const [updated] =
                    Object.keys(changes).length === 0
                        ? await db.select(colourColumns).from(colours).where(eq(colours.id, id))
                        : await db.update(colours).set(changes).where(eq(colours.id, id)).returning(colourColumns);
                if (!updated) throw notFound('Colour not found.');
                return updated;
            } catch (error) {
                rethrowNameTaken(error, input.name);
            }
        },

        async removeColour(id) {
            try {
                const deleted = await db.delete(colours).where(eq(colours.id, id)).returning({ id: colours.id });
                if (deleted.length === 0) throw notFound('Colour not found.');
            } catch (error) {
                rethrowInUse(error, 'Models offer this colour. Take it out of their colour options first.');
            }
        },

        async setMaterialColour(materialId, colourId, { inStock }) {
            const [material] = await db
                .select({ id: materials.id })
                .from(materials)
                .where(eq(materials.id, materialId));
            if (!material) throw notFound('Material not found.');
            const [colour] = await db
                .select({ name: colours.name, hex: colours.hex })
                .from(colours)
                .where(eq(colours.id, colourId));
            if (!colour) throw notFound('Colour not found.');
            try {
                await db
                    .insert(materialColours)
                    .values({ materialId, colourId, inStock })
                    .onConflictDoUpdate({
                        target: [materialColours.materialId, materialColours.colourId],
                        set: { inStock },
                    });
            } catch (error) {
                // The material or colour was deleted after the checks above.
                if (isPgError(error, PgErrorCode.foreignKeyViolation)) throw notFound('Material or colour not found.');
                throw error;
            }
            return { colourId, ...colour, inStock };
        },

        async removeMaterialColour(materialId, colourId) {
            const deleted = await db
                .delete(materialColours)
                .where(and(eq(materialColours.materialId, materialId), eq(materialColours.colourId, colourId)))
                .returning({ colourId: materialColours.colourId });
            if (deleted.length === 0) throw notFound('The material does not come in this colour.');
        },
    };
}
