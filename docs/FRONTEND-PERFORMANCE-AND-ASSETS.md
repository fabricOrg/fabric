# Frontend performance and asset handling

**Status:** Active engineering reference  
**Last verified:** 2026-08-08 — structural claims and the `/404` collision re-checked. The byte
figures below were measured on 2026-07-26 and have NOT been re-measured; treat them as that day's
build, not today's.

## Current posture

### Public site

`apps/www` is a static Astro/Starlight build. Landing-page bitmaps are imported from `src/assets`
and rendered with `astro:assets` `Image`, which:

- emits content-hashed files;
- converts PNG sources to WebP;
- generates explicit responsive widths;
- supplies intrinsic dimensions to prevent layout shift;
- lets the page declare accurate `sizes`;
- eagerly loads only the hero visual;
- lazy-loads below-the-fold images.

The current dashboard screenshot source is about 960 KiB, but the largest emitted WebP used in the
static build is about 75 KiB. Landing illustrations emit smaller responsive variants. Fonts are
self-hosted WOFF2 assets and are fingerprinted by the build.

Files placed in `apps/www/public` bypass Astro transformation. Use that directory only when a stable
filename is required, such as metadata assets. Authored page imagery belongs under `src/assets`.

### Authenticated applications

The dashboard and admin console use Next.js standalone output. Next performs route-level JavaScript
splitting, minification, CSS extraction, and content-hashed `_next` assets. Use `next/image` for
future raster content that needs responsive resizing. Keep data charts lazy and avoid importing
chart libraries into routes that do not render them.

### Containers

The API production image contains only the API dependency closure. Each frontend is built as a
separate deployable artifact. Static public-site assets are not copied into the API image.

## Findings

### Good

- The landing page uses the framework image pipeline rather than shipping source PNGs.
- Responsive widths and `sizes` are explicit.
- Only the first-viewport visual has high fetch priority.
- Fonts are local, compressed, and free from a third-party font runtime dependency.
- The public site is static, so content and media are CDN-cacheable.

### Risks

- No CI performance budget currently prevents an oversized image, font, CSS file, or client bundle
  from landing.
- Pagefind search assets are among the largest public-site JavaScript/Wasm outputs; they are useful
  on docs pages but should not become landing-page critical-path work.
- `apps/www` defines `src/pages/404.astro` while Starlight also supplies a static `/404` route.
  Astro currently warns and states that this collision will become a hard error in a future version.
- Authenticated applications have no documented per-route bundle budget.
- Source image dimensions and license/provenance are not recorded in one manifest.
- Visual regressions and layout shift are checked manually rather than by a repeatable Lighthouse
  or Web Vitals gate.

## Budgets

Start with warning thresholds, record a baseline, then make them blocking:

| Asset | Initial warning budget |
| --- | --- |
| Hero responsive image candidate | 180 KiB |
| Below-the-fold responsive image candidate | 120 KiB |
| Individual WOFF2 font | 60 KiB |
| Landing critical CSS | 80 KiB compressed |
| Landing critical client JavaScript | 100 KiB compressed |
| New authenticated-route client JavaScript | Baseline + 30 KiB compressed |

Budgets apply to emitted artifacts, not source files. A large lossless source is acceptable when the
build proves the delivered variants are small and visually adequate.

## Validation plan

1. Add a build-artifact size report for `apps/www` and both Next.js applications.
2. Run Lighthouse on the landing page at mobile and desktop widths.
3. Track LCP, CLS, INP, total blocking time, and transferred bytes.
4. Fail CI only after the baseline is stable and intentional exceptions have owners.
5. Add responsive screenshot checks for the landing hero and product screenshot.
6. Confirm below-the-fold images are not requested before they approach the viewport.
7. Verify Pagefind/search code is not in the landing critical path.
8. Remove the duplicate `/404` ownership by choosing either the app route or the Starlight route,
   then keep `astro check` warning-free.

## Asset rules

- Prefer framework imports over raw public paths.
- Provide meaningful alt text for informative images and empty alt text for decorative images.
- Do not preload every image or font.
- Use one first-viewport image as the LCP candidate.
- Avoid CSS background images for meaningful content because they lose responsive-image semantics.
- Keep original assets out of client bundles when only transformed variants are needed.
- Record the origin and usage rights of third-party assets.
