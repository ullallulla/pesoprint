import ReactMarkdown, { type Components } from 'react-markdown';

const components: Components = {
    h1: ({ children }) => <h2 className='mt-6 text-xl font-semibold'>{children}</h2>,
    h2: ({ children }) => <h2 className='mt-6 text-xl font-semibold'>{children}</h2>,
    h3: ({ children }) => <h3 className='mt-4 text-lg font-semibold'>{children}</h3>,
    p: ({ children }) => <p className='mt-3 leading-relaxed'>{children}</p>,
    ul: ({ children }) => <ul className='mt-3 list-disc space-y-1 pl-6'>{children}</ul>,
    ol: ({ children }) => <ol className='mt-3 list-decimal space-y-1 pl-6'>{children}</ol>,
    a: ({ href, children }) => (
        <a
            href={href}
            className='underline underline-offset-4 hover:text-foreground'
            rel='nofollow noopener noreferrer'
        >
            {children}
        </a>
    ),
    code: ({ children }) => <code className='rounded bg-muted px-1 py-0.5 text-sm'>{children}</code>,
    // Descriptions may only link to images elsewhere; the gallery shows the product's own images.
    img: () => null,
};

/**
 * Renders a product description. react-markdown never renders raw HTML from the source,
 * so a description can't inject markup or scripts.
 */
export function Markdown({ children }: { children: string }) {
    return (
        <div className='text-muted-foreground [&>*:first-child]:mt-0'>
            <ReactMarkdown components={components}>{children}</ReactMarkdown>
        </div>
    );
}
