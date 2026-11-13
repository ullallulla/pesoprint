import ReactMarkdown, { type Components } from 'react-markdown';
import { Link } from 'react-router';

/** `## Cookies {#cookies}` → the heading "Cookies" with id="cookies", so pages can link to a section. */
export function splitHeadingId(text: string): { text: string; id?: string } {
    const match = /^(.*?)\s*\{#([\w-]+)\}$/.exec(text);
    return match ? { text: match[1]!, id: match[2] } : { text };
}

function heading(Tag: 'h2' | 'h3', className: string): Components['h2'] {
    return function Heading({ children }) {
        if (typeof children === 'string') {
            const { text, id } = splitHeadingId(children);
            return (
                <Tag id={id} className={className}>
                    {text}
                </Tag>
            );
        }
        return <Tag className={className}>{children}</Tag>;
    };
}

const linkClass = 'font-medium text-foreground underline underline-offset-4';

const components: Components = {
    // The page title is the h1; sections in the text start at h2.
    h1: heading('h2', 'mt-10 scroll-mt-24 text-2xl font-semibold text-foreground'),
    h2: heading('h2', 'mt-10 scroll-mt-24 text-2xl font-semibold text-foreground'),
    h3: heading('h3', 'mt-6 scroll-mt-24 text-lg font-semibold text-foreground'),
    p: ({ children }) => <p className='mt-4 leading-relaxed'>{children}</p>,
    ul: ({ children }) => <ul className='mt-4 list-disc space-y-2 pl-6'>{children}</ul>,
    ol: ({ children }) => <ol className='mt-4 list-decimal space-y-2 pl-6'>{children}</ol>,
    strong: ({ children }) => <strong className='font-semibold text-foreground'>{children}</strong>,
    code: ({ children }) => <code className='rounded bg-muted px-1 py-0.5 text-sm'>{children}</code>,
    a: ({ href = '', children }) =>
        href.startsWith('/') ? (
            <Link to={href} className={linkClass}>
                {children}
            </Link>
        ) : (
            <a href={href} className={linkClass} rel='noopener noreferrer'>
                {children}
            </a>
        ),
};

/** A legal text (terms, privacy policy), written in Markdown. */
export function LegalPage({ title, children }: { title: string; children: string }) {
    return (
        <main className='mx-auto w-full max-w-3xl flex-1 px-4 py-12 md:py-16'>
            <h1 className='text-4xl font-bold tracking-tight'>{title}</h1>
            <div className='mt-4 text-muted-foreground'>
                <ReactMarkdown components={components}>{children}</ReactMarkdown>
            </div>
        </main>
    );
}
