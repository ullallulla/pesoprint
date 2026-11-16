import { z } from 'zod';

/**
 * What prints can be made of. A material (PLA, PETG…) has colours, and each colour can be out of stock.
 * Which materials a model can be printed in, and its price in each, is set per model (M4).
 */

/** `#rrggbb`, lowercase: what `<input type="color">` sends. */
export const HEX_COLOUR_PATTERN = '^#[0-9a-f]{6}$';

export const colourSchema = z
    .object({
        id: z.uuid(),
        materialId: z.uuid(),
        name: z.string(),
        /** The swatch shown to buyers, e.g. `#1f6feb`. */
        hex: z.string(),
        /** Out-of-stock colours stay listed but can't be ordered. */
        inStock: z.boolean(),
        /** Order among the material's colours, lowest first. */
        position: z.int().nonnegative(),
    })
    .meta({ id: 'Colour' });
export type Colour = z.infer<typeof colourSchema>;

export const materialSchema = z
    .object({
        id: z.uuid(),
        name: z.string(),
        /** A line for buyers, e.g. "Tough and slightly flexible. Good for parts that take a knock." */
        description: z.string().nullable(),
        /** Inactive materials are hidden from buyers, but kept for past orders. */
        active: z.boolean(),
        /** Order in lists, lowest first. */
        position: z.int().nonnegative(),
    })
    .meta({ id: 'Material' });
export type Material = z.infer<typeof materialSchema>;

/** A material as the admin sees it, with all its colours. */
export const adminMaterialSchema = materialSchema
    .extend({ colours: z.array(colourSchema) })
    .meta({ id: 'AdminMaterial' });
export type AdminMaterial = z.infer<typeof adminMaterialSchema>;

export const adminMaterialListSchema = z
    .object({ materials: z.array(adminMaterialSchema) })
    .meta({ id: 'AdminMaterialList' });
export type AdminMaterialList = z.infer<typeof adminMaterialListSchema>;

const position = z.int().min(0).max(10_000);

const materialInputFields = z.object({
    name: z.string().trim().min(1).max(50),
    description: z.string().trim().max(300).nullable().optional(),
    active: z.boolean().optional(),
    position: position.optional(),
});

export const createMaterialSchema = materialInputFields.meta({ id: 'CreateMaterial' });
export type CreateMaterial = z.infer<typeof createMaterialSchema>;

/** Only the fields that are present change. `description: null` clears it. */
export const updateMaterialSchema = materialInputFields.partial().meta({ id: 'UpdateMaterial' });
export type UpdateMaterial = z.infer<typeof updateMaterialSchema>;

const colourInputFields = z.object({
    name: z.string().trim().min(1).max(50),
    hex: z.string().trim().toLowerCase().regex(new RegExp(HEX_COLOUR_PATTERN), 'Use a colour like #1f6feb.'),
    inStock: z.boolean().optional(),
    position: position.optional(),
});

export const createColourSchema = colourInputFields.meta({ id: 'CreateColour' });
export type CreateColour = z.infer<typeof createColourSchema>;

/** Only the fields that are present change. */
export const updateColourSchema = colourInputFields.partial().meta({ id: 'UpdateColour' });
export type UpdateColour = z.infer<typeof updateColourSchema>;
