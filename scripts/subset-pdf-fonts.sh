#!/usr/bin/env bash
# Regenerates the Noto Sans subsets that chart PDF export embeds
# (app/src/store/chartExport/pdfFonts.ts). jsPDF can only draw text in a
# font it's been handed as a TTF, and its built-in fonts cover Latin-1
# only, so without these any name outside Western European scripts comes
# out as garbage. The full Noto Sans TTFs are ~600 KB each; subsetting to
# the ranges below (Latin + extensions, Greek, Cyrillic, common
# punctuation/symbols) brings each down to about a third of that. Text
# with characters outside these ranges makes the PDF export fall back to
# embedding a high-resolution image of the chart instead.
#
# KEEP IN SYNC with PDF_FONT_RANGES in app/src/store/chartExport/pdfFonts.ts.
#
# Needs fontTools (pip install fonttools) and the Noto Sans TTFs (Debian/
# Ubuntu: fonts-noto-core). Override the source dir with NOTO_DIR=...
set -euo pipefail
NOTO_DIR="${NOTO_DIR:-/usr/share/fonts/truetype/noto}"
OUT="$(dirname "$0")/../app/src/assets/fonts"
RANGES="U+0020-007E,U+00A0-024F,U+0250-02FF,U+0300-036F,U+0370-03FF,U+0400-052F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2212,U+2460-24FF,U+25A0-25FF,U+2600-26FF"
mkdir -p "$OUT"
for style in Regular Bold; do
  pyftsubset "$NOTO_DIR/NotoSans-$style.ttf" \
    --unicodes="$RANGES" \
    --layout-features='*' --no-hinting --desubroutinize \
    --output-file="$OUT/NotoSans-$style-subset.ttf"
done
ls -l "$OUT"
