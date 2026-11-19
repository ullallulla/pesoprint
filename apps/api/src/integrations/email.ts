import { Resend } from 'resend';

/** An email ready to send: both an HTML and a plain-text version. */
export interface EmailMessage {
    to: string;
    subject: string;
    html: string;
    text: string;
}

/**
 * Sends email, behind a small interface so tests can use a fake. `idempotencyKey` makes a retried send of the
 * same email a no-op at the provider (Resend remembers keys for 24 hours), so a crash between sending and
 * recording it doesn't send it twice.
 */
export interface Mailer {
    send(message: EmailMessage, options: { idempotencyKey: string }): Promise<{ id: string | null }>;
}

/** Resend over HTTPS (not SMTP, which Render's free plan blocks). */
export function createResendMailer({
    apiKey,
    from,
    replyTo,
}: {
    apiKey: string;
    /** e.g. `Pesoprint <orders@pesoprint.allulab.eu>`; its domain must be verified in Resend. */
    from: string;
    replyTo: string | undefined;
}): Mailer {
    const resend = new Resend(apiKey);
    return {
        async send({ to, subject, html, text }, { idempotencyKey }) {
            const { data, error } = await resend.emails.send(
                { from, to, subject, html, text, ...(replyTo && { replyTo }) },
                { idempotencyKey },
            );
            // The SDK reports API errors in `error` instead of throwing.
            if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
            return { id: data?.id ?? null };
        },
    };
}

/** For local development without a Resend key: prints the email instead of sending it. */
export function createConsoleMailer(): Mailer {
    return {
        async send({ to, subject, text }) {
            console.log(
                `\n--- Email (not sent: RESEND_API_KEY isn't set) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`,
            );
            return { id: null };
        },
    };
}
