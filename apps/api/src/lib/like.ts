/** Escapes `%`, `_` and `\` so user input matches literally inside an ILIKE pattern. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');
