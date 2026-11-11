# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, served equally from the first visit:

- **Makers with a 3D printer** who want model files: free downloads (no account needed) or paid STL/3MF files they keep in an account library.
- **People without a printer** who want a finished object, printed in a material and colour they choose and shipped to them.

The same model is usually available both ways, so a visitor can switch paths on any product.

## Product Purpose

Pesoprint (working name) is an online shop for 3D printing. Each model can be offered as a free download, a paid digital file, or a physical print. Success means a visitor quickly finds a model, understands which of those options it offers and what each costs, and completes the download, purchase, or print order.

It is also a portfolio piece, so the craft and code quality are part of the product.

## Positioning

A one-person studio, not a marketplace. The owner designs or curates every model and prints and ships the physical orders. One catalogue serves both people who print at home and people who don't. The data model is ready for other creators later, but at launch there is one seller.

## Operating Context

- Catalogue: categories, full-text search, sorting, pagination. The model mix is still open (functional parts, home/decor, toys/figures are all possible), so the design must not depend on one niche.
- Product page: image gallery and an interactive 3D preview (GLB, react-three-fiber), download / buy file / order print, and a material and colour picker whose price comes from the server.
- Print materials (PLA, PETG, …) have surcharges. Colours belong to a material and can be out of stock.
- Shown on models: download counts, rating average and count (verified buyers only), favourites.
- Checkout: own checkout page (address, shipping, VAT), then payment on Mollie's hosted page.
- Market default: EUR, English UI, ships to Finland first, then the EU. Finnish may come later.

## Capabilities and Constraints

- Stack in place: React Router (framework mode, SSR), Tailwind v4, shadcn/ui, lucide icons, Clerk for sign-in.
- Free downloads need no account. Buying anything needs an account.
- Prices are always calculated by the server; the UI only displays them.
- Undecided: final name, market/language, file formats offered (STL / 3MF / STEP), licence tiers, print pricing formula, shipping carriers, and the catalogue focus.

## Brand Commitments

"Pesoprint" is a working name and may change, so the identity should not depend on it. No logo, palette or typeface has been chosen. The current UI is the default shadcn theme, kept only as a placeholder.

## Evidence on Hand

None yet: no real model photos, reviews, download counts, customers or press. Designs use clearly marked placeholder content and must not present invented numbers, testimonials or claims as real.

## Product Principles

1. **Three ways to get every model, made clear at a glance.** Free, file and print are never hidden behind a click or a guess.
2. **The object is the hero.** Photos and the 3D preview lead; the interface supports them.
3. **Honest pricing.** Material, colour, shipping and VAT are visible before checkout, with no surprises.
4. **Made by a person.** It should feel like a small studio that prints things itself, not an anonymous marketplace.

## Accessibility & Inclusion

Target WCAG 2.2 AA (an accessibility and Lighthouse pass is part of launch readiness). Colour swatches need text names, not just colour.
