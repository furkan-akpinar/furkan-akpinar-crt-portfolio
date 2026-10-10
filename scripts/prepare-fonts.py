"""Build or verify the portfolio's Latin/Turkish WOFF2 font subsets.

This optional asset-authoring tool is not needed by npm ci/build. Install the
versions in fonts-manifest.json in a separate Python environment to regenerate.
Original font files stay outside the application/release; licenses stay public.
"""

import argparse
import hashlib
import io
import json
from pathlib import Path

import fontTools
from fontTools import subset
from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / "public" / "fonts"
MANIFEST = ROOT / "scripts" / "fonts-manifest.json"
# Include Latin Extended A/B, decomposed accents, punctuation, currency, and
# arrows. This is a language subset, not an exact-current-copy glyph whitelist.
RANGES = ((0x20, 0x24F), (0x300, 0x36F), (0x2000, 0x206F),
          (0x20A0, 0x20CF), (0x2190, 0x21FF))
MASTERS = (
    "STIXTwoText-Variable.0bc5ea7347a0.woff2",
    "STIXTwoText-Italic-Variable.81bf90b78b72.woff2",
    "VT323-Regular.7be16f26185d.woff2",
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source_codepoints():
    # Also preserve any symbols in current scene/semantic copy that are outside
    # the language ranges. Escape sequences used in code are covered by ASCII.
    return {ord(char) for file in (ROOT / "src").rglob("*")
            if file.suffix in (".ts", ".tsx", ".css")
            for char in file.read_text(encoding="utf-8") if ord(char) >= 0x20}


def coverage():
    return set().union(*(range(start, end + 1) for start, end in RANGES),
                       source_codepoints())


def axes(font):
    return [{"tag": axis.axisTag, "min": axis.minValue,
             "default": axis.defaultValue, "max": axis.maxValue}
            for axis in font["fvar"].axes] if "fvar" in font else []


def sfnt_bytes(font):
    output = io.BytesIO()
    flavor = font.flavor
    font.flavor = None
    font.save(output, reorderTables=False)
    font.flavor = flavor
    return output.getvalue()


def compare_shaping(original, prepared, text):
    import uharfbuzz as hb

    original_face = hb.Face(sfnt_bytes(original))
    prepared_face = hb.Face(sfnt_bytes(prepared))
    comparison_count = 0
    for weight in ((400, 450, 500, 550, 600, 650, 700)
                   if "fvar" in original else (400,)):
        for language in ("tr", "en"):
            results = []
            for face, font_file in ((original_face, original), (prepared_face, prepared)):
                font = hb.Font(face)
                font.scale = (face.upem, face.upem)
                font.set_variations({"wght": weight})
                buffer = hb.Buffer()
                buffer.add_str(text)
                buffer.guess_segment_properties()
                buffer.language = language
                hb.shape(font, buffer)
                results.append([(font_file.getGlyphName(info.codepoint), info.cluster,
                                 pos.x_advance, pos.y_advance, pos.x_offset, pos.y_offset)
                                for info, pos in zip(buffer.glyph_infos, buffer.glyph_positions)])
            assert results[0] == results[1], f"Shaping changed at weight {weight}, language {language}"
            comparison_count += 1
    return comparison_count


def compare_outlines(original, prepared):
    count = 0
    for weight in ((400, 450, 500, 550, 600, 650, 700)
                   if "fvar" in original else (400,)):
        location = {"wght": weight} if "fvar" in original else None
        before = original.getGlyphSet(location=location)
        after = prepared.getGlyphSet(location=location)
        for name in prepared.getGlyphOrder():
            before_pen, after_pen = RecordingPen(), RecordingPen()
            before[name].draw(before_pen)
            after[name].draw(after_pen)
            assert before_pen.value == after_pen.value, f"Outline changed: {name}, {weight}"
            assert before[name].width == after[name].width, f"Variable width changed: {name}, {weight}"
            count += 1
    return count


def prepare(source_dir, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    desired = coverage()
    entries = []
    corpus = "\n".join(file.read_text(encoding="utf-8") for file in (ROOT / "src").rglob("*")
                       if file.suffix in (".ts", ".tsx"))
    for filename in MASTERS:
        source = source_dir / filename
        raw = source.read_bytes()
        assert digest(raw).startswith(filename.split(".")[-2]), f"Master hash mismatch: {source}"
        original = TTFont(io.BytesIO(raw), recalcTimestamp=False)
        font = TTFont(io.BytesIO(raw), recalcTimestamp=False)
        original_cmap = original.getBestCmap()
        kept = set(original_cmap) & desired
        options = subset.Options()
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.name_legacy = True
        options.glyph_names = True
        options.notdef_outline = True
        options.recommended_glyphs = True
        options.recalc_timestamp = False
        options.hinting = True
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=kept)
        subsetter.subset(font)
        font.flavor = "woff2"
        output = io.BytesIO()
        font.save(output, reorderTables=False)
        encoded = output.getvalue()
        prepared = TTFont(io.BytesIO(encoded), recalcTimestamp=False)
        assert set(prepared.getBestCmap()) == kept
        assert axes(original) == axes(prepared), "Variable weight range changed"
        assert original["head"].unitsPerEm == prepared["head"].unitsPerEm
        for glyph in prepared.getGlyphOrder():
            if glyph in original["hmtx"].metrics:
                assert original["hmtx"][glyph] == prepared["hmtx"][glyph], f"Metrics changed: {glyph}"
        for codepoint, glyph in prepared.getBestCmap().items():
            assert original_cmap[codepoint] == glyph
        sample = "".join(char for char in corpus if ord(char) in kept)
        sample += "\n" + " ".join(chr(codepoint) for codepoint in sorted(kept))
        sample += " ffi ffl fi fl AV To Wa İstanbul IĞDIR ŞİŞLİ ÇÖĞÜŞ çğıöşü I\u0307 S\u0327 G\u0306 0123456789 → …"
        shape_count = compare_shaping(original, prepared, sample)
        outline_count = compare_outlines(original, prepared)
        name = filename.rsplit(".", 2)[0] + "." + digest(encoded)[:12] + ".woff2"
        (output_dir / name).write_bytes(encoded)
        entries.append({"source": filename, "sourceSha256": digest(raw),
                        "sourceBytes": len(raw), "file": name, "sha256": digest(encoded),
                        "bytes": len(encoded), "codepoints": sorted(kept),
                        "originalCodepoints": sorted(original_cmap), "axes": axes(prepared),
                        "glyphCount": len(prepared.getGlyphOrder()),
                        "shapingComparisons": shape_count,
                        "outlineComparisons": outline_count})
    manifest = {"schema": 1, "fontToolsVersion": fontTools.__version__,
                "brotliVersion": "1.2.0", "uharfbuzzVersion": "0.56.3",
                "coverageRanges": [[start, end] for start, end in RANGES],
                "files": entries}
    (output_dir / "fonts-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"beforeBytes": sum(item["sourceBytes"] for item in entries),
                      "afterBytes": sum(item["bytes"] for item in entries),
                      "shapingComparisons": sum(item["shapingComparisons"] for item in entries),
                      "outlineComparisons": sum(item["outlineComparisons"] for item in entries)}, indent=2))


def verify():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    requested = coverage()
    for entry in manifest["files"]:
        data = (FONT_DIR / entry["file"]).read_bytes()
        assert digest(data) == entry["sha256"]
        assert len(data) == entry["bytes"]
        font = TTFont(io.BytesIO(data), recalcTimestamp=False)
        assert set(font.getBestCmap()) == set(entry["codepoints"])
        assert requested & set(entry["originalCodepoints"]) <= set(font.getBestCmap()), \
            "Current copy requires another glyph from the original font; regenerate the subset."
        assert axes(font) == entry["axes"]
    print("Font bytes, character coverage and variable axes verified.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, help="Original hash-named WOFF2 files, outside the repo")
    parser.add_argument("--output-dir", type=Path, help="Candidate directory, outside public")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.verify:
        verify()
    elif args.source_dir and args.output_dir:
        prepare(args.source_dir, args.output_dir)
    else:
        parser.error("Use --verify or both --source-dir and --output-dir")
