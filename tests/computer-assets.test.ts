import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assetGroupFiles, releaseAssetGroups } from '../scripts/release-assets.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const modelRelative = 'public/models/furkan-crt';
const modelFile = 'furkan-crt-computer.glb';
const publicDirectory = path.join(root, 'public');

function isolatedFixture(t: { after(callback: () => void): void }) {
  const temporaryBase = realpathSync(os.tmpdir());
  const temporary = mkdtempSync(path.join(temporaryBase, 'crt-model-verify-'));
  t.after(() => {
    assert.ok(path.resolve(temporary).startsWith(temporaryBase + path.sep));
    assert.ok(path.basename(temporary).startsWith('crt-model-verify-'));
    rmSync(temporary, { recursive: true, force: true });
  });
  mkdirSync(path.join(temporary, 'scripts'));
  mkdirSync(path.join(temporary, modelRelative), { recursive: true });
  copyFileSync(path.join(root, 'scripts/verify-computer.mjs'), path.join(temporary, 'scripts/verify-computer.mjs'));
  for (const file of readdirSync(path.join(root, modelRelative))) {
    copyFileSync(path.join(root, modelRelative, file), path.join(temporary, modelRelative, file));
  }
  return {
    directory: temporary,
    model: path.join(temporary, modelRelative, modelFile),
    manifest: path.join(temporary, modelRelative, 'model-manifest.json'),
    verify: () => spawnSync(process.execPath, ['scripts/verify-computer.mjs'], {
      cwd: temporary, encoding: 'utf8', timeout: 30_000,
    }),
  };
}

test('release includes one self-contained model and excludes retired model packages', () => {
  assert.deepEqual(releaseAssetGroups.models, ['models/furkan-crt']);
  assert.deepEqual(assetGroupFiles(publicDirectory, releaseAssetGroups.models), [
    'models/furkan-crt/ATTRIBUTION.txt',
    'models/furkan-crt/furkan-crt-computer.glb',
    'models/furkan-crt/model-manifest.json',
  ]);
  assert.deepEqual(readdirSync(path.join(publicDirectory, 'models')), ['furkan-crt']);
});

test('approved CRT package verifies in a clean clone without dependencies or authoring sources', t => {
  const fixture = isolatedFixture(t);
  assert.equal(existsSync(path.join(fixture.directory, 'node_modules')), false);
  const result = fixture.verify();
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, 'verified');
  assert.equal(summary.modelUrl, '/models/furkan-crt/furkan-crt-computer.glb');
  assert.equal(summary.externalDependencies, 0);
  assert.equal(summary.embeddedImages.length, 3);
  assert.equal(summary.meshes, 6);
  assert.ok(summary.bytes < 512 * 1024 && summary.triangles < 15_000);
});

test('a changed embedded payload fails integrity verification', t => {
  const fixture = isolatedFixture(t);
  const bytes = readFileSync(fixture.model);
  bytes[bytes.length - 8] ^= 1;
  writeFileSync(fixture.model, bytes);
  const result = fixture.verify();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Model SHA-256 changed/);
});

test('a rehashed malformed container fails structural verification', t => {
  const fixture = isolatedFixture(t);
  const bytes = readFileSync(fixture.model);
  bytes.writeUInt32LE(bytes.length - 4, 8);
  writeFileSync(fixture.model, bytes);
  const manifest = JSON.parse(readFileSync(fixture.manifest, 'utf8'));
  manifest.sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(fixture.manifest, JSON.stringify(manifest));
  const result = fixture.verify();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid GLB length/);
});
