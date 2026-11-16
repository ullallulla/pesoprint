import { cn } from 'cn';

/**
 * A round swatch of one colour, or of several in equal slices for a multicolour print ("Black / Orange").
 * Decorative: say the colour's name in text next to it.
 */
export function ColourSwatch({ colours, className }: { colours: readonly { hex: string }[]; className?: string }) {
    const slice = 360 / Math.max(colours.length, 1);
    const background =
        colours.length <= 1
            ? colours[0]?.hex
            : `conic-gradient(${colours
                  .map((colour, index) => `${colour.hex} ${index * slice}deg ${(index + 1) * slice}deg`)
                  .join(', ')})`;
    return (
        <span
            aria-hidden
            className={cn('inline-block size-5 shrink-0 rounded-full border shadow-xs', className)}
            style={{ background }}
        />
    );
}
