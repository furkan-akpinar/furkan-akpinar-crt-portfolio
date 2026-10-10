# Font asset preparation

The application ships language subsets of the original STIX Two Text normal and
italic variable fonts, plus VT323 Regular. Families, weights, glyph outlines,
hinting and OpenType layout features are preserved. The subset retains Latin
Extended A/B, combining accents, punctuation, currencies, arrows and the
characters currently present in application source. Turkish text and future
numeric dates are covered; this is not an exact-copy-only subset.

The three WOFF2 files total **199,520 bytes**, down from **394,172 bytes**. Only
the current hash-named files are published. The original font licenses remain in
`public/fonts/OFL-STIXTwoText.txt` and `public/fonts/OFL-VT323.txt`; they also apply
to these subsets. No font shape was redrawn and no attribution was removed.
The bundled STIX license reserves the name `TM Math`; neither STIX Two Text
font uses it as its primary name. VT323's bundled copyright notice declares no
Reserved Font Name. The original internal names and CSS families are retained.

## Normal build

The checked-in WOFF2 files are ready to use. `npm ci`, `npm test` and `npm run build`
do not require Python or a font-authoring dependency. The Node font tests check
asset hashes, the CSS/preload references, and whether changed application copy
needs any character that was removed from the original fonts.

## Regeneration

Use a separate Python environment, not the application dependency tree:

```sh
python -m pip install "fonttools[woff]==4.66.1" "brotli==1.2.0" "uharfbuzz==0.56.3"
python scripts/prepare-fonts.py --source-dir /path/to/original-fonts --output-dir /path/to/candidates
```

The input names and full SHA-256 hashes are recorded in `fonts-manifest.json`.
Keep original masters and generated candidates outside this repository/public.
The generator verifies original hash-named files, preserves all layout features
and names, and compares every retained glyph outline at weights 400, 450, 500,
550, 600, 650 and 700. It also compares HarfBuzz shaping and positioning for
Turkish/English source text, Latin coverage, ligatures, combining accents and
digits. VT323 is checked at its single original weight.

After reviewing candidates, copy only the three generated WOFF2 files into
`public/fonts`, replace the old files, copy the generated manifest into `scripts`,
and update the three matching URLs in `src/app/globals.css` and `src/app/layout.tsx`.
Then run:

```sh
python scripts/prepare-fonts.py --verify
node --experimental-strip-types --test tests/fonts.test.ts
```

The generation performed 14,373 retained-glyph outline/width comparisons and 30
HarfBuzz shaping comparisons without a difference. These checks preserve font
data and typography metrics; they are not a substitute for browser screenshots
or a claim that every physical device has been tested. The WOFF2 delivery format
and font-loading behavior are unchanged.

A Windows Edge 155 canvas comparison also found no pixel difference in 81
combinations of family/style, weight, 16/32/64px size and DPR 1/1.5/3, using
Turkish text, digits, punctuation and decomposed accents. This verifies that
browser and platform, not physical Safari or every device.
