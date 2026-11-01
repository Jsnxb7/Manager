# Design plan — chrome, ash grey and graphite

Apply the installed frontend-design skill at `C:/Users/shour/.agents/skills/frontend-design/SKILL.md`, verified against Anthropic's published frontend-design source on 2026-11-01. Its process is design plan -> review against brief -> implement -> critique. This document is the planning pass; no UI has been implemented yet.

## Palette

| Token | Hex | Role |
| --- | --- | --- |
| Graphite | #242629 | Main background and desktop chrome |
| Slate graphite | #303338 | Panels, rail and toolbar |
| Brushed ash | #42474D | Raised controls and selected surfaces |
| Steel | #747C85 | Separators, inactive controls and secondary details |
| Chrome | #C9CFD5 | Primary actions, focus accents and highlights |
| Pale ash | #F1F3F5 | Main text and icons |

Validate foreground/background combinations before assigning text roles. Dark text on chrome buttons; pale ash on graphite. Small status indicators may use restrained accessible semantic colors plus labels/icons; never depend on color alone. Anime artwork supplies the screen's prominent color. Avoid decorative neon, warm cream and full-screen animated backgrounds.

## Typography and geometry

Plan: bundled, license-checked Source Sans 3 for readable library labels and controls, with system fallback. Native rendering must support the intended weights on Android and Windows. Proposed scale: 12/14/16/20/26/34; title wraps rather than truncating essential identity, tabular digits for playback time only. Sentence-case labels, left alignment, no decorative all-caps microcopy.

8-point spacing rhythm with 4-point refinements; compact rows and generous touch hit areas. Proposed 6px controls / 10px cards / 16px sheets express hierarchy rather than identical rounded boxes. Thin steel dividers and subtle material highlights suggest brushed metal without texture assets or costly blur. Focus rings are high contrast.

## Layouts

Preserve the old app's poster-led browsing, Continue Watching strip, detail/relations tabs, episode cards and persistent queue. Replace floating-control clutter with predictable navigation/action placement; each old action remains mapped in feature-map.md.

```text
Wide desktop / landscape tablet
+-----------+--------------------------------------+-------------+
| Home      | Search + filters + Add                | Queue drawer|
| Libraries | Continue Watching                    | optional    |
| Queue     | Poster grid / Details / Episodes      |             |
| Player    |                                      |             |
| Settings  |                                      |             |
+-----------+--------------------------------------+-------------+

Phone / narrow window
+--------------------------------+
| Title                 Actions  |
| Search                         |
| Filter chips                   |
| Continue Watching              |
| Adaptive two-column cover grid |
|                                |
| Home   Libraries   Queue  More |
+--------------------------------+
```

Breakpoints follow available content width, not an assumed device type. Detail hero becomes stacked on phones; Relations order controls remain touch-accessible. Player prioritizes video, with audio/subtitle/queue controls in a sheet on narrow screens. Forms become one column with clear inline validation.

## Interaction and resource rules

- Minimum accessible touch targets; keyboard navigation/focus and screen-reader labels on all targets.
- No required hover behavior. Metadata opens a tap/focus sheet or popover.
- Short state-driven transitions; reduced motion replaces animations with immediate changes.
- WebP covers in bounded sizes; vector/native icons. Optional WebM only when decoder support is established and a still fallback exists. No shader/blur-heavy background effects.
- Delete confirmation names the title, device-local folder and fact that videos will be deleted. This preserves intentional source behavior.
- Empty libraries invite adding/importing; missing media offers relinking; write failures retain user edits.

## Review against the brief

The palette follows the user's monochrome direction. Poster artwork is the one expressive visual element; the surrounding chrome stays restrained. Existing navigation and actions remain recognizable. Typography and material hierarchy are deliberate, while dense desktop tools become touch-accessible sheets on mobile. Full screenshot/device critique is reserved for final verification, consistent with the user's phase policy.
