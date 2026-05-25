# n5f — In-app image lightbox

**Bead:** `tcg-card-sniper-dev-n5f` · **Theme:** UX
**Status:** ✅ shipped

## What it does

The eBay listing photo grid in `LotAnalyzerModal` used to wrap each thumbnail in `<a href={imageUrl} target="_blank">` — clicking opened a new browser tab and broke the user's flow. Now clicks open a full-screen lightbox overlaid on top of the analyzer modal:

- Click any photo → full-size image overlays, centered
- Press **Escape**, click the **X** in the top-right corner, or click the dark backdrop → closes
- Modal underneath stays open the whole time; no new browser tabs

Scope is intentionally narrow per user direction: only the analyzer's photo grid. Card-art thumbnails (picker rows, sold-comp rows, saved-lot rows, deal feed, watchlist) and other listing thumbnails (NotificationDrawer, CardDetailDrawer) are non-interactive — clicking them does nothing.

## Architecture

```
LotAnalyzerModal
   │
   ├── grid renders <button onClick={() => setLightboxSrc(img.imageUrl)}>
   │
   └── <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
          │
          └── Radix Dialog (portal) → Overlay (z-60) + Content with <img>
```

`ImageLightbox` is built on Radix Dialog primitives directly rather than the styled `components/ui/dialog` wrapper — the wrapper's default `max-w-lg` + padding + border + bg would box the image in. We need a bare transparent container. `z-[60]` keeps the lightbox above `LotAnalyzerModal`'s own `z-50` createPortal mount.

## Files

- [client/src/components/shared/ImageLightbox.tsx](../../client/src/components/shared/ImageLightbox.tsx) — new component
- [client/src/components/shared/__tests__/ImageLightbox.test.tsx](../../client/src/components/shared/__tests__/ImageLightbox.test.tsx) — 5 tests
- [client/src/components/shared/LotAnalyzerModal.tsx](../../client/src/components/shared/LotAnalyzerModal.tsx) — swapped `<a target="_blank">` for `<button>`, added `lightboxSrc` state, mounted `<ImageLightbox>` at root, reset on lot change

## Verification

- [x] Client build clean
- [x] 60/60 client tests (was 55)
- [ ] Hands-on: open any lot in the analyzer → click any photo → lightbox opens; press Esc/click X/click backdrop → closes; modal underneath stays open
