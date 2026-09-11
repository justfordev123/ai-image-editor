# Brand fonts

The user supplied these TTF files on September 10, 2026. Angular serves this folder at `/fonts/`; `src/styles.scss` uses matching `@font-face` and fallback-stack family names.

- `strokeWeightvar.ttf`: primary family `strokeWeight(var)`. Its `wght` axis supports 20–180 (default 100), and `slnt` supports −12–12 (default 0).
- `Eina03-Regular.ttf`: static fallback family `Eina03-Regular`, regular weight 400.

The UI sets variable-font weight 60 for normal text, 80 for headings, and 120 for the wordmark. Buttons keep the same primary font family and weight 60 when hovered, changing the variable font slant from 0 to 12. Light outlined, text, and icon buttons use a `#000000` hover background with white text/icons; dark filled buttons use a white hover background with black text/icons. Disabled buttons keep their disabled appearance. These are the original supplied files, with no conversion or modification.
