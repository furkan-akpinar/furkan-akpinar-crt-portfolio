// Next replaces this direct environment access before hashing browser chunks.
// Local development and source-level tests keep the ordinary public paths.
const roots: Record<string, string> = JSON.parse(process.env.NEXT_PUBLIC_ASSET_ROOTS ?? '{}');

export function publicAssetUrl(path: string) {
  const group = path.split('/')[1];
  return `${roots[group] ?? ''}${path}`;
}
