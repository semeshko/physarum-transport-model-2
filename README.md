# Physarum Transport Model 2.0

The current MapLibre / CARTO Dark Matter basemap is retained. OSIRIS is a reference only.

## Basemap access

Create `.env.local` from `.env.example` and set your own `NEXT_PUBLIC_CARTO_API_KEY`. Obtain it through [CARTO](https://carto.com/basemaps/apikey/). Restart dev after changing it; production requires a new build. No credential is supplied by this repository.

This browser key is public by design: use provider-supported domain restrictions, not a privileged account credential. `.env.local` is Git-ignored. The app warns when the key is missing; rendering without one does not establish authorized or reliable access. Authentication is attached only to HTTPS CARTO basemap hosts for styles, sprites, glyphs and tiles. OpenStreetMap/CARTO attribution is explicitly expanded.

## Real Analyze

Start without the synthetic sample. Select a small map area and use **Load OSM network**. Inspect loaded bounds, snapshot date, retrieval date, provider, topology diagnostics and urban context status. A retrieval today can return an old snapshot.

`loaded`, `empty`, `partial` and `unavailable` are distinct. Failure does not mean zero buildings/water. **Retry urban context** reuses the acquired transport payload through the standard adapter. Incomplete context requires **Analyze with incomplete urban context** before running.

Choose **Pedestrian**, **Select source**, **Select sink**, then **Run**. Repeat with **Motor**. Changing terminals/profile invalidates the result. **Reset runtime** retains terminals; **Clear scenario** removes them. Selecting another area blocks a run on the old dataset until that area is loaded.

Transport retains OSM node identities through the standard adapter, not the scratch converter. The graph remains undirected; one-way routing and full turn restrictions are not enforced. Context imports supported ways, not complete relation/multipolygon geometry. Empty does not prove absence of relation-only objects. Displaying context does not automatically turn every polygon into an Analyze constraint.

OSM dataset versions depend on analytical features, snapshot metadata and context availability, not basemap credentials, camera or cache access time. This is not a complete scenario archive: retain actual inputs for reproducibility; live OSM counts can change.

## Verification

Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`. See [the existing audit](docs/codex-claude-handoff-audit.md) for tested cases and limitations. Passing tests do not certify all historical scientific claims. Design development is paused.

The following are the original framework setup notes.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
