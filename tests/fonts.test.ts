import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, 'scripts/fonts-manifest.json'), 'utf8')) as {
  files: Array<{
    file: string;
    bytes: number;
    sha256: string;
    codepoints: number[];
    originalCodepoints: number[];
    axes: Array<{ tag: string; min: number; default: number; max: number }>;
  }>;
};

function sourceText(directory: string): string {
  return readdirSync(directory, { withFileTypes: true }).map(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceText(file);
    return /\.(?:ts|tsx|css)$/.test(entry.name) ? readFileSync(file, 'utf8') : '';
  }).join('\n');
}

test('published font files match their content hashes and the preload/CSS URLs', () => {
  const directory = path.join(root, 'public/fonts');
  const actual = readdirSync(directory).filter(file => file.endsWith('.woff2')).sort();
  assert.deepEqual(actual, manifest.files.map(font => font.file).sort());
  const css = readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
  const layout = readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
  for (const font of manifest.files) {
    const bytes = readFileSync(path.join(directory, font.file));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
    assert.equal(hash, font.sha256);
    assert.ok(font.file.includes(hash.slice(0, 12)));
    assert.equal(bytes.length, font.bytes);
    assert.ok(css.includes(`/fonts/${font.file}`));
    assert.ok(layout.includes(`/fonts/${font.file}`));
  }
});

test('subsets retain original-font coverage for current copy, Turkish, digits and punctuation', () => {
  const copy = sourceText(path.join(root, 'src'));
  const required = new Set([...copy, ...'ÇĞİÖŞÜçğıöşü0123456789 → … — – · “ ” ‘ ’'].map(char => char.codePointAt(0)!));
  for (const font of manifest.files) {
    const original = new Set(font.originalCodepoints);
    const retained = new Set(font.codepoints);
    for (const codepoint of required) {
      if (original.has(codepoint)) {
        assert.ok(retained.has(codepoint), `${font.file} needs U+${codepoint.toString(16)}; regenerate the subset`);
      }
    }
    if (font.file.startsWith('STIX')) {
      assert.deepEqual(font.axes, [{ tag: 'wght', min: 400, default: 400, max: 700 }]);
    } else {
      assert.deepEqual(font.axes, []);
    }
  }
});
