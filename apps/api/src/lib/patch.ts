/**
 * Drops `undefined` fields from a PATCH body, so only the fields the client sent are written.
 * `null` is kept: it means "clear this field".
 */
export function definedFields<T extends object>(input: T): Partial<T> {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}
