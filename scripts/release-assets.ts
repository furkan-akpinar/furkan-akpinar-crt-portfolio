import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Keep each release asset group under a deterministic content version. */
export const releaseAssetGroups = {
  models: ['models/furkan-crt'],
  images: ['images/about-portrait.webp', 'images/contact-portrait.webp', 'images/projects/posters'],
  media: ['media/hero-pinterest/showreel.mp4', 'media/hero-pinterest/light-tracks.json'],
  textures: ['textures/no-signal-label.webp'],
} as const;

export function assetGroupFiles(publicDirectory: string, entries: readonly string[]): string[] {
  return entries.flatMap(relative => {
    const file = path.join(publicDirectory, relative);
    const entry = lstatSync(file);
    assert.ok(!entry.isSymbolicLink(), 'Release assets must not follow symbolic links.');
    if (entry.isDirectory()) {
      return assetGroupFiles(publicDirectory, readdirSync(file).map(name => `${relative}/${name}`));
    }
    assert.ok(entry.isFile(), `Release asset must be a regular file: ${relative}`);
    return [relative];
  }).sort();
}

export function createAssetRoots(publicDirectory: string, groups: Record<string, readonly string[]> = releaseAssetGroups) {
  return Object.fromEntries(Object.entries(groups).map(([group, entries]) => {
    const hash = createHash('sha256');
    for (const relative of assetGroupFiles(publicDirectory, entries)) {
      const bytes = readFileSync(path.join(publicDirectory, relative));
      hash.update(`${relative}\0${bytes.length}\0`).update(bytes);
    }
    return [group, `/assets/${hash.digest('hex').slice(0, 20)}`];
  }));
}
