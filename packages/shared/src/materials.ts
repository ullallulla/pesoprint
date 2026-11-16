import { z } from 'zod';

/**
 * What prints are made of, and the colours they come in. Colours are one shared list; each material lists the
 * colours you have it in (its filaments), each in stock or not, and whether it can mix colours in one print.
 * A model sets which materials it can be printed in (with a price for each) and, if the buyer gets to choose,
 * its colour options. A buyer sees the options the chosen material can make.
 */

/** `#rrggbb`, lowercase: what `<input type="color">` sends. */
export const HEX_COLOUR_PATTERN = '^#[0-9a-f]{6}$';

export const colourSchema = z
    .object({
        id: z.uuid(),
        name: z.string(),
        /** The swatch shown to buyers, e.g. `#1f6feb`. */
        hex: z.string(),
        /** Order in lists, lowest first. */
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
        /** Whether several colours can be combined in one print. Off: only single-colour options are offered. */
        multicolour: z.boolean(),
        /** Order in lists, lowest first. */
        position: z.int().nonnegative(),
    })
    .meta({ id: 'Material' });
export type Material = z.infer<typeof materialSchema>;

/** A colour you have a material in (a filament), and whether it's in stock. */
export const materialColourSchema = z
    .object({
        colourId: z.uuid(),
        name: z.string(),
        hex: z.string(),
        /** Out-of-stock filaments stay listed but can't be ordered. */
        inStock: z.boolean(),
    })
    .meta({ id: 'MaterialColour' });
export type MaterialColour = z.infer<typeof materialColourSchema>;

/** A material as the admin sees it, with the colours you have it in (in the colours' order). */
export const adminMaterialSchema = materialSchema
    .extend({ colours: z.array(materialColourSchema) })
    .meta({ id: 'AdminMaterial' });
export type AdminMaterial = z.infer<typeof adminMaterialSchema>;

export const adminMaterialListSchema = z
    .object({ materials: z.array(adminMaterialSchema) })
    .meta({ id: 'AdminMaterialList' });
export type AdminMaterialList = z.infer<typeof adminMaterialListSchema>;

export const adminColourListSchema = z.object({ colours: z.array(colourSchema) }).meta({ id: 'AdminColourList' });
export type AdminColourList = z.infer<typeof adminColourListSchema>;

/** Most colours in one colour option: a print in up to four colours, e.g. "Red / Black". */
export const MAX_OPTION_COLOURS = 4;

/** What buyers see for a colour option: its colours' names, e.g. "Red / Black". */
export function colourOptionName(colours: readonly { name: string }[]): string {
    return colours.map((colour) => colour.name).join(' / ');
}

const position = z.int().min(0).max(10_000);

const materialInputFields = z.object({
    name: z.string().trim().min(1).max(50),
    description: z.string().trim().max(300).nullable().optional(),
    active: z.boolean().optional(),
    multicolour: z.boolean().optional(),
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
    position: position.optional(),
});

export const createColourSchema = colourInputFields.meta({ id: 'CreateColour' });
export type CreateColour = z.infer<typeof createColourSchema>;

/** Only the fields that are present change. */
export const updateColourSchema = colourInputFields.partial().meta({ id: 'UpdateColour' });
export type UpdateColour = z.infer<typeof updateColourSchema>;

/** Adds the colour to the material (you have it in this colour), or changes whether it's in stock. */
export const setMaterialColourSchema = z
    .object({ inStock: z.boolean().default(true) })
    .meta({ id: 'SetMaterialColour' });
export type SetMaterialColour = z.infer<typeof setMaterialColourSchema>;

/**
 * Whether a material can print a colour option: it comes in every one of the option's colours, and can mix
 * colours if there are several. `null`: it can't. Otherwise whether every one of them is in stock.
 */
export function optionInMaterial(
    option: { colourIds: readonly string[] },
    material: { multicolour: boolean; colours: readonly { colourId: string; inStock: boolean }[] },
): { inStock: boolean } | null {
    if (option.colourIds.length > 1 && !material.multicolour) return null;
    const filaments = option.colourIds.map((id) => material.colours.find((colour) => colour.colourId === id));
    if (filaments.some((filament) => filament === undefined)) return null;
    return { inStock: filaments.every((filament) => filament!.inStock) };
}
