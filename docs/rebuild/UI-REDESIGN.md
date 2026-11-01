# UI redesign rules

These rules come from the user and override DESIGN.md wherever they differ. The frontend-design skill is guidance only.

## Look

- Every page, including the Hub, sits on the mountain background image (`Root.tsx` draws it and a dark wash). The top bar continues that image. Pages never set their own background.
- Content pages sit on one solid night-blue panel from `PanelPage` in `components/Fade.tsx`. It covers the full width and fades in at the top only, starting above the heading. The Hub has no panel.
- Covers, titles and cards have no fades, except the Player's previous and next covers, which fade into the panel.
- All text uses `fontFamily` from `design/theme.ts` (Bahnschrift on Windows). Text colours are ash `colors.text` and charcoal-grey `colors.muted`.
- No containers and no boxes. No card backgrounds, no card borders, no glass, no blur, no boxed sections. Content goes straight on the panel.
- Separate groups with space, type size, or a thin `ui.rule` line. Lists use division lines, not boxes.
- Buttons are the only boxy things, and there should be few of them. Prefer `IconButton` from `components/Icon.tsx` for secondary actions. Only the main action on a screen is an expanded `Button primary`.
- Inputs are `Field` or `ui.input`: an underline, not a box.
- Colours only from `colors` in `design/theme.ts`. Text styles only from `ui` and `displayFamily`.
- No emoji in UI. Icons come from `Icon`. If an icon is missing, ask rather than adding one.
- Sentence case. No all-caps labels or eyebrow labels above headings.

## Layout

- Must work from phone width (360) to wide desktop. `useWindowDimensions`; phone is `width < 700`.
- Navigation is owned by `NavBar` in `Root.tsx`: top bar on desktop, bottom bar on phones. Do not add home, back, queue, player or settings buttons inside pages.

## Behaviour

- Redesign only. Keep every existing action, state, service call, validation and accessibility label unless the user asked to remove it. Domain, service and repository code stays unchanged.
- Bundled images must be `.webp`. Bundled images carry an intrinsic size, so size them through a wrapping view when anchoring to edges.
- Hover effects need a touch alternative. Use `onHoverIn`/`onHoverOut` on `Pressable`. Use Sheet confirmations, not `Alert.alert`.

## Checks

- `npx tsc --noEmit`, and `npx jest --runInBand` for touched behaviour, from `native/`. `src/dev/` is temporary local preview data: never edit it or depend on it.
