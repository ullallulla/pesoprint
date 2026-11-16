import type {
    AdminMaterial,
    Colour,
    CreateColour,
    CreateMaterial,
    Material,
    UpdateColour,
    UpdateMaterial,
} from '@app/shared';
import { asc, eq } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { isPgError, PgErrorCode } from '../db/errors.ts';
import { colours, materials } from '../db/schema.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { definedFields } from '../lib/patch.ts';

export interface MaterialsService {
    /** Every material with all its colours, each ordered by position then name. */
    list(): Promise<AdminMaterial[]>;
    create(input: CreateMaterial): Promise<Material>;
    update(id: string, input: UpdateMaterial): Promise<Material>;
    /** Deletes the material and its colours. Refused (409) once anything refers to them. */
    remove(id: string): Promise<void>;
    addColour(materialId: string, input: CreateColour): Promise<Colour>;
    updateColour(id: string, input: UpdateColour): Promise<Colour>;
    /** Refused (409) once anything refers to the colour. */
    removeColour(id: string): Promise<void>;
}

const materialColumns = {
    id: materials.id,
    name: materials.name,
    description: materials.description,
    active: materials.active,
    position: materials.position,
};

const colourColumns = {
    id: colours.id,
    materialId: colours.materialId,
    name: colours.name,
    hex: colours.hex,
    inStock: colours.inStock,
    position: colours.position,
};

/** Names are unique regardless of case: a material among materials, a colour within its material. */
function rethrowNameTaken(error: unknown, name: string | undefined): never {
    if (isPgError(error, PgErrorCode.uniqueViolation, 'materials_name_unique')) {
        const message = `There is already a material called “${name}”.`;
        throw conflict(message, [{ path: 'name', message }]);
    }
    if (isPgError(error, PgErrorCode.uniqueViolation, 'colours_material_id_name_unique')) {
        const message = `This material already has a colour called “${name}”.`;
        throw conflict(message, [{ path: 'name', message }]);
    }
    throw error;
}

/** Something (a model's print options, an order) still refers to the row. */
function rethrowInUse(error: unknown, message: string): never {
    if (isPgError(error, PgErrorCode.restrictViolation) || isPgError(error, PgErrorCode.foreignKeyViolation)) {
        throw conflict(message);
    }
    throw error;
}

export function createMaterialsService(db: Database): MaterialsService {
    return {
        async list() {
            const [materialRows, colourRows] = await Promise.all([
                db.select(materialColumns).from(materials).orderBy(asc(materials.position), asc(materials.name)),
                db.select(colourColumns).from(colours).orderBy(asc(colours.position), asc(colours.name)),
            ]);
            return materialRows.map((material) => ({
                ...material,
                colours: colourRows.filter((colour) => colour.materialId === material.id),
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
                const [updated] =
                    Object.keys(changes).length === 0
                        ? await db.select(materialColumns).from(materials).where(eq(materials.id, id))
                        : await db
                              .update(materials)
                              .set(changes)
                              .where(eq(materials.id, id))
                              .returning(materialColumns);
                if (!updated) throw notFound('Material not found.');
                return updated;
            } catch (error) {
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

        async addColour(materialId, input) {
            const [material] = await db
                .select({ id: materials.id })
                .from(materials)
                .where(eq(materials.id, materialId));
            if (!material) throw notFound('Material not found.');
            try {
                const [created] = await db
                    .insert(colours)
                    .values({ ...input, materialId })
                    .returning(colourColumns);
                return created!;
            } catch (error) {
                // The material was deleted after the check above.
                if (isPgError(error, PgErrorCode.foreignKeyViolation)) throw notFound('Material not found.');
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
                rethrowInUse(error, 'This colour is in use. Mark it out of stock instead.');
            }
        },
    };
}
