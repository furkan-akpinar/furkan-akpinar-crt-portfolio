import { serveVideoRange } from './video-range.ts';
import { HERO_REEL_ASSET } from './hero-reel-asset.ts';

type Encoding = 'br' | 'gzip' | 'identity';
type AssetBinding = { fetch(request: Request): Promise<Response> };
type WorkerRequest = Request & { cf?: { clientAcceptEncoding?: string } };

/** Explicit exclusions also override a wildcard, including identity;q=0. */
export function acceptedEncodings(header: string | null): Encoding[] {
  if (!header?.trim()) return ['identity'];
  const weights = new Map<string, number>();
  for (const token of header.toLowerCase().split(',')) {
    const [name, ...parameters] = token.trim().split(';');
    const quality = parameters.find(value => value.trim().startsWith('q='))?.trim().slice(2);
    const weight = quality === undefined ? 1 : Number(quality);
    weights.set(name, Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0);
  }
  return (['br', 'gzip', 'identity'] as const)
    .map(encoding => ({
      encoding,
      weight: weights.get(encoding) ?? (encoding === 'identity'
        ? (weights.get('*') === 0 ? 0 : 1)
        : (weights.get('*') ?? 0)),
    }))
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map(({ encoding }) => encoding);
}

function varyByEncoding(headers: Headers) {
  const names = (headers.get('Vary') ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!names.some(value => value.toLowerCase() === 'accept-encoding') && !names.includes('*')) {
    names.push('Accept-Encoding');
  }
  headers.set('Vary', names.join(', '));
}

const geometryPath = /^(?:\/assets\/[a-f0-9]{20})?\/models\/commodore64\/web\/geometry\.bin$/;
const videoPath = /^(?:\/assets\/[a-f0-9]{20})?\/media\/hero-pinterest\/showreel\.mp4$/;

export async function serveAsset(request: WorkerRequest, assets: AssetBinding): Promise<Response> {
  const url = new URL(request.url);
  if (videoPath.test(url.pathname) && ['GET', 'HEAD'].includes(request.method)) {
    const currentReel = url.pathname === HERO_REEL_ASSET.path || url.pathname === HERO_REEL_ASSET.root + HERO_REEL_ASSET.path;
    return serveVideoRange(request, assets, currentReel ? HERO_REEL_ASSET.bytes : undefined);
  }
  if (!geometryPath.test(url.pathname) || !['GET', 'HEAD'].includes(request.method)) {
    return assets.fetch(request);
  }

  // Cloudflare may normalize the forwarded header. Its original value records
  // what the browser supports; local Wrangler exposes the regular header.
  const encodings = acceptedEncodings(request.cf?.clientAcceptEncoding ?? request.headers.get('Accept-Encoding'));
  if (request.headers.has('Range') && encodings.includes('identity')) {
    // A range addresses the original geometry bytes, not a compressed stream.
    const rangeHeaders = new Headers(request.headers);
    rangeHeaders.set('Accept-Encoding', 'identity');
    const response = await assets.fetch(new Request(request, { headers: rangeHeaders }));
    const headers = new Headers(response.headers);
    varyByEncoding(headers);
    if (response.status >= 400) headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  }

  for (const encoding of encodings) {
    const variant = new URL(url);
    if (encoding !== 'identity') variant.pathname += encoding === 'br' ? '.br' : '.gz';
    const headers = new Headers(request.headers);
    headers.delete('Range');
    headers.delete('If-Range');
    headers.set('Accept-Encoding', 'identity');
    const response = await assets.fetch(new Request(variant, { method: request.method, headers }));
    if (encoding !== 'identity' && response.status === 404) {
      await response.body?.cancel();
      continue;
    }
    const resultHeaders = new Headers(response.headers);
    varyByEncoding(resultHeaders);
    if (response.status >= 400) resultHeaders.set('Cache-Control', 'no-store');
    if ([200, 304].includes(response.status)) {
      resultHeaders.set('Content-Type', 'application/octet-stream');
      if (encoding !== 'identity') {
        resultHeaders.set('Content-Encoding', encoding);
        resultHeaders.delete('Accept-Ranges');
      }
    }
    // Sidecar bytes are already encoded at build time. Do not compress twice.
    const init = { status: response.status, headers: resultHeaders, encodeBody: 'manual' as const };
    return new Response(response.body, init);
  }
  return new Response(null, {
    status: 406,
    headers: { 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' },
  });
}

const assetWorker = {
  fetch(request: WorkerRequest, env: { ASSETS: AssetBinding }) {
    return serveAsset(request, env.ASSETS);
  },
};

export default assetWorker;
