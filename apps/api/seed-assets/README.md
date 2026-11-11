# Seed assets

Real model files and images for the development seed (`vp run db:seed`). Everything in this folder
except this README is **gitignored**:

- A model committed to a public repository can be downloaded by anyone, including files that are for sale, and it
  stays in the git history even after it's deleted.
- Third-party models may only be shared under the terms of their licence.

## Layout

One folder per model. The folder name becomes the product slug (lowercase letters, numbers and hyphens).

```
seed-assets/
  cable-clip/
    cable-clip.stl        ← model files: .stl, .3mf, .step/.stp, .obj (up to 1 GB)
    photo-1.jpg           ← images: .jpg, .png, .webp, .avif (up to 10 MB); sorted by name, the first is the cover
    photo-2.jpg
    source.json           ← product details and where the design came from
```

## source.json

```json
{
    "title": "Cable Clip",
    "description": "Snaps onto a desk edge and holds up to three cables.",
    "category": "cable-management",
    "digitalPriceCents": 0,
    "printBasePriceCents": 990,
    "license": "cc_by_nc",
    "size": [20, 15, 12],
    "featured": true
}
```

- `category`: the slug of a seed category (see `SEED_CATEGORIES` in `src/db/seed.ts`).
- `digitalPriceCents`: `0` for a free download, a price for a paid file, or leave it out if the file isn't offered.
  Prices are euro cents including VAT.
- `printBasePriceCents`: leave it out if the model isn't offered as a print.
- `license`: an id from `packages/shared/src/licenses.ts`. Required when the file is offered.
- `size`: printed width, depth and height in mm. `printWeightG` (grams of filament) is optional too.
- `featured`: show it in the home page's featured section.
- `designer` and `url`: credit for designs that aren't the shop's own, shown at the end of the description.

The seed checks every model against the same publishing rules as the admin (category, an image, a licence and a
download file when the file is offered) and stops with the folder name if one fails.

With `S3_*` storage configured, `vp run db:seed` uploads the files to `seed/products/<slug>/` (images to the public
bucket, model files to the private one). Files already there with the same size are skipped.

## Before adding someone else's design

Check its licence on the original page. As a rule of thumb for this project:

| Licence                            | Use here                                      |
| ---------------------------------- | --------------------------------------------- |
| CC BY, CC BY-SA, CC0, GPL/LGPL/BSD | Yes, as a free download, with credit          |
| CC BY-ND                           | Unchanged files only: no generated 3D preview |
| CC BY-NC (any variant)             | No, unless the designer has given permission  |
| Standard Digital File / paid       | No                                            |

Images from a model page are covered by the same licence as the model.
