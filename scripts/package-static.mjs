import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exported = path.join(root, 'out');
const output = path.join(root, 'dist');
const marker = '.portfolio-build.json';
const maxBytes = 25 * 1024 * 1024;
const assets = [
  '_headers', 'model-credits.html', 'social-preview.png',
  'fonts/STIXTwoText-Variable.ttf', 'fonts/STIXTwoText-Italic-Variable.ttf', 'fonts/VT323-Regular.ttf',
  'fonts/OFL-STIXTwoText.txt', 'fonts/OFL-VT323.txt',
  'images/about-team.png', 'images/people-atlas.png', 'images/projects/posters',
  'models/commodore64/web', 'models/commodore64/mobile', 'models/commodore64/ATTRIBUTION.txt',
  'media/hero-pinterest/showreel.mp4', 'media/hero-pinterest/light-tracks.json',
  'textures/no-signal-label.png',
];

function copyReleaseAsset(source, destination) {
  // Avoid Node 22.18's Windows fs.cpSync crash on non-ASCII source paths.
  // Copy regular file bytes only; reject links before following any directory.
  const entry = lstatSync(source);
  assert.ok(!entry.isSymbolicLink(), 'Release assets must be regular files.');
  if (entry.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) {
      copyReleaseAsset(path.join(source, name), path.join(destination, name));
    }
  } else {
    assert.ok(entry.isFile(), 'Release assets must be regular files.');
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

assert.ok(existsSync(path.join(exported, 'index.html')), 'Run next build before packaging.');
assert.equal(path.dirname(output), root, 'Output must remain in the project.');
if (existsSync(output)) {
  assert.ok(!lstatSync(output).isSymbolicLink(), 'Refusing a linked output directory.');
  assert.equal(realpathSync(output), output, 'Output path must not resolve elsewhere.');
  assert.equal(JSON.parse(readFileSync(path.join(output, marker), 'utf8')).owner, 'furkan-portfolio-static', 'Refusing to remove an unowned output directory.');
  rmSync(output, { recursive: true });
}
mkdirSync(output, { recursive: true });
// Write ownership immediately so a failed build can safely be retried.
writeFileSync(path.join(output, marker), JSON.stringify({ owner: 'furkan-portfolio-static' }));

// Next copies all local public archives into out/. Select generated routes/chunks
// separately, then copy only the assets used by the released application.
const publicNames = new Set(readdirSync(path.join(root, 'public')));
for (const entry of readdirSync(exported)) {
  if (!publicNames.has(entry)) copyReleaseAsset(path.join(exported, entry), path.join(output, entry));
}
for (const relative of assets) {
  const source = path.join(root, 'public', relative);
  assert.ok(existsSync(source), `Missing release asset: ${relative}`);
  copyReleaseAsset(source, path.join(output, relative));
}

function inventory(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'Release assets must be regular files.');
    if (entry.isDirectory()) return inventory(file);
    if (entry.name === marker) return [];
    const bytes = readFileSync(file);
    const relative = path.relative(output, file).split(path.sep).join('/');
    assert.ok(bytes.length <= maxBytes, `${relative} exceeds Cloudflare's 25 MiB asset limit.`);
    assert.ok(!/(^|\/)(\.env|docs|node_modules|\.git)(\/|$)/.test(relative), `Unexpected private/build file: ${relative}`);
    return [{ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
  });
}
const files = inventory(output);
writeFileSync(path.join(output, marker), JSON.stringify({ owner: 'furkan-portfolio-static', files }, null, 2) + '\n');
console.log(`Static release: ${files.length} files, ${(files.reduce((total, file) => total + file.bytes, 0) / 1024 / 1024).toFixed(2)} MiB. Every asset is below 25 MiB.`);
