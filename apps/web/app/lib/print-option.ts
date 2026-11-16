import type { CartLine } from '@app/shared';

/** "PLA, Black / Orange", or just "PLA" when the model is printed in the colours shown. */
export function printOptionText(print: NonNullable<CartLine['print']>): string {
    return print.colourName ? `${print.materialName}, ${print.colourName}` : print.materialName;
}
