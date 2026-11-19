import { formatVatRate, PARCEL_SIZE_NAMES, type PrintChoice, type ShippingAddress } from '@app/shared';

import type { Order, OrderItem } from '../db/schema.ts';

/** What the order emails show. */
export interface OrderEmailInput {
    order: Pick<
        Order,
        | 'id'
        | 'subtotalCents'
        | 'shippingCents'
        | 'parcelSize'
        | 'totalCents'
        | 'taxCents'
        | 'vatRateBp'
        | 'shippingAddress'
        | 'carrier'
        | 'trackingNumber'
        | 'immediateDeliveryConsentAt'
        | 'paidAt'
        | 'refundedCents'
    >;
    items: Pick<OrderItem, 'type' | 'titleSnapshot' | 'printSnapshot' | 'quantity' | 'unitPriceCents'>[];
}

export interface OrderEmailOptions {
    /** The web app's address, for links. No trailing slash. */
    siteUrl: string;
    /** Put before every subject, e.g. `[Staging] `, so test emails stand out. */
    subjectPrefix?: string;
}

export interface RenderedEmail {
    subject: string;
    html: string;
    text: string;
}

const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const longDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Europe/Helsinki' });

const price = (cents: number) => euro.format(cents / 100);

/**
 * A short reference for an order, e.g. `7F3A9C21`: the end of its id. Ids are UUIDv7, whose start is a
 * timestamp shared by orders placed close together, and whose end is random. The admin's search finds it.
 */
export function orderReference(orderId: string): string {
    return orderId.replaceAll('-', '').slice(-8).toUpperCase();
}

export function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function printLabel(print: PrintChoice | null): string {
    if (!print) return '';
    return `Print: ${print.materialName}, ${print.colourName ?? 'in the colours shown'}`;
}

function addressLines(address: ShippingAddress): string[] {
    return [
        address.name,
        address.line1,
        address.line2,
        `${address.postalCode} ${address.city}`,
        address.country === 'FI' ? 'Finland' : address.country,
    ].filter((line): line is string => !!line);
}

/**
 * One email in two versions. `blocks` are rendered in order; each block knows how to write itself as HTML
 * (inline styles only: email clients ignore stylesheets) and as plain text.
 */
type TotalRow = [label: string, value: string, strong?: boolean];

type Block =
    | { kind: 'heading'; text: string }
    | { kind: 'paragraph'; text: string }
    | { kind: 'button'; text: string; href: string }
    | { kind: 'items'; items: OrderEmailInput['items'] }
    | { kind: 'totals'; rows: TotalRow[] }
    | { kind: 'details'; title: string; lines: string[] };

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MUTED = '#6b7280';

function blockHtml(block: Block): string {
    switch (block.kind) {
        case 'heading':
            return `<h2 style="margin:28px 0 8px;font-size:18px;color:#111827">${escapeHtml(block.text)}</h2>`;
        case 'paragraph':
            return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#111827">${escapeHtml(block.text)}</p>`;
        case 'button':
            return `<p style="margin:18px 0 22px"><a href="${escapeHtml(block.href)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:6px">${escapeHtml(block.text)}</a></p>`;
        case 'items':
            return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0">${block.items
                .map(
                    (item) =>
                        `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:15px;color:#111827">${escapeHtml(item.titleSnapshot)}${item.quantity > 1 ? ` × ${item.quantity}` : ''}<br><span style="font-size:13px;color:${MUTED}">${escapeHtml(item.type === 'print' ? printLabel(item.printSnapshot) : 'Model file')}</span></td><td align="right" style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-size:15px;color:#111827;white-space:nowrap;vertical-align:top">${price(item.unitPriceCents * item.quantity)}</td></tr>`,
                )
                .join('')}</table>`;
        case 'totals':
            return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 8px">${block.rows
                .map(
                    ([label, value, strong]) =>
                        `<tr><td style="padding:3px 0;font-size:${strong ? 15 : 13}px;color:${strong ? '#111827' : MUTED};${strong ? 'font-weight:600' : ''}">${escapeHtml(label)}</td><td align="right" style="padding:3px 0;font-size:${strong ? 15 : 13}px;color:${strong ? '#111827' : MUTED};${strong ? 'font-weight:600' : ''}">${escapeHtml(value)}</td></tr>`,
                )
                .join('')}</table>`;
        case 'details':
            return `<p style="margin:14px 0;font-size:15px;line-height:1.55;color:#111827"><strong>${escapeHtml(block.title)}</strong><br>${block.lines.map(escapeHtml).join('<br>')}</p>`;
    }
}

function blockText(block: Block): string {
    switch (block.kind) {
        case 'heading':
            return `${block.text.toUpperCase()}\n`;
        case 'paragraph':
            return `${block.text}\n`;
        case 'button':
            return `${block.text}: ${block.href}\n`;
        case 'items':
            return `${block.items
                .map(
                    (item) =>
                        `- ${item.titleSnapshot}${item.quantity > 1 ? ` × ${item.quantity}` : ''}: ${price(item.unitPriceCents * item.quantity)}\n  ${item.type === 'print' ? printLabel(item.printSnapshot) : 'Model file'}`,
                )
                .join('\n')}\n`;
        case 'totals':
            return `${block.rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n`;
        case 'details':
            return `${block.title}\n${block.lines.join('\n')}\n`;
    }
}

function render(subject: string, preview: string, blocks: Block[], siteUrl: string): RenderedEmail {
    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px"><tr><td style="padding:28px 28px 20px;font-family:${FONT}">
<p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#111827">Pesoprint</p>
${blocks.map(blockHtml).join('\n')}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:${MUTED};font-family:${FONT}">Pesoprint · <a href="${escapeHtml(siteUrl)}" style="color:${MUTED}">${escapeHtml(siteUrl.replace(/^https?:\/\//, ''))}</a> · Reply to this email if you have questions.</p>
</td></tr></table>
</body>
</html>`;
    const text = `${blocks.map(blockText).join('\n')}\n--\nPesoprint · ${siteUrl}\nReply to this email if you have questions.\n`;
    return { subject, html, text };
}

/**
 * Sent once an order is paid. For model files: where to download them, and the record that the buyer agreed
 * to immediate delivery and so gave up the right of withdrawal (under EU rules the right only ends once the
 * buyer has this confirmation). For prints: that we'll print and post them, and their right of withdrawal.
 */
export function orderConfirmationEmail(
    { order, items }: OrderEmailInput,
    { siteUrl, subjectPrefix = '' }: OrderEmailOptions,
): RenderedEmail {
    const reference = orderReference(order.id);
    const files = items.filter((item) => item.type === 'digital');
    const prints = items.filter((item) => item.type === 'print');
    const blocks: Block[] = [
        { kind: 'paragraph', text: 'Thank you for your order. Your payment has been received.' },
        {
            kind: 'paragraph',
            text: `Order ${reference}${order.paidAt ? `, paid on ${longDate.format(order.paidAt)}` : ''}.`,
        },
        { kind: 'items', items },
        {
            kind: 'totals',
            rows: [
                ...(order.parcelSize
                    ? ([
                          ['Items', price(order.subtotalCents)],
                          [`Shipping (${PARCEL_SIZE_NAMES[order.parcelSize]} parcel)`, price(order.shippingCents)],
                      ] satisfies TotalRow[])
                    : []),
                ['Total', price(order.totalCents), true],
                [`Includes VAT ${formatVatRate(order.vatRateBp)}`, price(order.taxCents)],
            ],
        },
    ];

    if (files.length > 0) {
        blocks.push(
            { kind: 'heading', text: files.length === 1 ? 'Your file is ready' : 'Your files are ready' },
            {
                kind: 'paragraph',
                text: `Download ${files.length === 1 ? 'it' : 'them'} any time from your library. ${files.length === 1 ? 'It stays' : 'They stay'} there, also if the model is later taken off sale.`,
            },
            { kind: 'button', text: 'Open your library', href: `${siteUrl}/library` },
        );
        const consentDate = order.immediateDeliveryConsentAt ?? order.paidAt;
        blocks.push({
            kind: 'paragraph',
            text: `When ordering${consentDate ? ` on ${longDate.format(consentDate)}` : ''}, you agreed that the model files are delivered right away, and acknowledged that you therefore lose your 14-day right of withdrawal for them.`,
        });
    }

    if (prints.length > 0) {
        blocks.push(
            { kind: 'heading', text: prints.length === 1 ? 'Your print' : 'Your prints' },
            {
                kind: 'paragraph',
                text: "We'll print your order and post it to the address below. You'll get another email with the tracking number when it's on its way.",
            },
        );
        if (order.shippingAddress) {
            blocks.push({ kind: 'details', title: 'Delivery address', lines: addressLines(order.shippingAddress) });
        }
        blocks.push({
            kind: 'paragraph',
            text: `You can withdraw from the purchase of the prints within 14 days of receiving them. Our terms explain how: ${siteUrl}/terms`,
        });
    }

    blocks.push({ kind: 'button', text: 'View your order', href: `${siteUrl}/orders/${order.id}` });

    return render(
        `${subjectPrefix}Your Pesoprint order ${reference}`,
        `Payment received for order ${reference}.`,
        blocks,
        siteUrl,
    );
}

/** Sent once an order's prints are handed to the carrier: the carrier and tracking number. */
export function orderShippedEmail(
    { order, items }: OrderEmailInput,
    { siteUrl, subjectPrefix = '' }: OrderEmailOptions,
): RenderedEmail {
    const reference = orderReference(order.id);
    const prints = items.filter((item) => item.type === 'print');
    const blocks: Block[] = [
        {
            kind: 'paragraph',
            text: `Good news: the ${prints.length === 1 ? 'print' : 'prints'} from your order ${reference} ${prints.length === 1 ? 'is' : 'are'} on the way.`,
        },
        {
            kind: 'details',
            title: 'Tracking',
            lines: [`Carrier: ${order.carrier ?? '–'}`, `Tracking number: ${order.trackingNumber ?? '–'}`],
        },
        { kind: 'items', items: prints },
    ];
    if (order.shippingAddress) {
        blocks.push({ kind: 'details', title: 'Delivery address', lines: addressLines(order.shippingAddress) });
    }
    blocks.push(
        {
            kind: 'paragraph',
            text: `Your 14-day right of withdrawal for the prints starts when you receive the parcel. If anything arrives damaged or misprinted, reply to this email with a photo and we'll make it right.`,
        },
        { kind: 'button', text: 'View your order', href: `${siteUrl}/orders/${order.id}` },
    );

    return render(
        `${subjectPrefix}Your Pesoprint order ${reference} has shipped`,
        `${order.carrier ?? 'Your parcel'} tracking number: ${order.trackingNumber ?? ''}`,
        blocks,
        siteUrl,
    );
}

/** Sent once an order is refunded in full: how much, and that its files are no longer in the library. */
export function orderRefundedEmail(
    { order, items }: OrderEmailInput,
    { siteUrl, subjectPrefix = '' }: OrderEmailOptions,
): RenderedEmail {
    const reference = orderReference(order.id);
    const hasFiles = items.some((item) => item.type === 'digital');
    const blocks: Block[] = [
        {
            kind: 'paragraph',
            text: `We've refunded ${price(order.refundedCents)} for your order ${reference} to the card or account you paid with.`,
        },
        {
            kind: 'paragraph',
            text: 'It usually shows within 5–10 business days, depending on your bank.',
        },
        { kind: 'items', items },
    ];
    if (hasFiles) {
        blocks.push({
            kind: 'paragraph',
            text: 'The model files from this order have been removed from your library.',
        });
    }
    blocks.push({ kind: 'button', text: 'View your order', href: `${siteUrl}/orders/${order.id}` });

    return render(
        `${subjectPrefix}Your Pesoprint order ${reference} has been refunded`,
        `${price(order.refundedCents)} refunded for order ${reference}.`,
        blocks,
        siteUrl,
    );
}
