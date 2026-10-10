type AssetBinding = { fetch(request: Request): Promise<Response> };
type ByteRange = { start: number; end: number };

function parseRange(header: string, size: number): ByteRange | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  // Unknown units, malformed and multipart ranges may legally receive the full body.
  if (!match || (!match[1] && !match[2])) return null;
  if (!size) return 'unsatisfiable';
  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : 'unsatisfiable';
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (start >= size || requestedEnd < start) return 'unsatisfiable';
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function matchesIfRange(value: string | null, headers: Headers) {
  if (!value) return true;
  if (value.startsWith('"')) return value === headers.get('ETag');
  if (value.startsWith('W/')) return false;
  const modified = headers.get('Last-Modified');
  return modified !== null && Date.parse(modified) === Date.parse(value);
}

/** Forward just the requested bytes with bounded memory and upstream cancellation. */
function sliceStream(body: ReadableStream<Uint8Array>, range: ByteRange) {
  const reader = body.getReader();
  let offset = 0;
  let remaining = range.end - range.start + 1;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (remaining > 0) {
        const { done, value } = await reader.read();
        if (done) throw new Error('Video asset ended before its advertised byte range.');
        const first = Math.max(0, range.start - offset);
        const last = Math.min(value.byteLength, range.end + 1 - offset);
        offset += value.byteLength;
        if (last <= first) continue;
        const chunk = value.subarray(first, last);
        remaining -= chunk.byteLength;
        controller.enqueue(chunk);
        if (remaining === 0) {
          controller.close();
          await reader.cancel().catch(() => {});
        }
        return;
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

/** Some static-asset responses ignore Range. Keep native support when available. */
export async function serveVideoRange(request: Request, assets: AssetBinding, verifiedSize?: number): Promise<Response> {
  let response = await assets.fetch(request);
  const rangeHeader = request.headers.get('Range');
  if (response.status !== 200) return response;
  const encoding = response.headers.get('Content-Encoding');
  const lengthHeader = response.headers.get('Content-Length');
  if (encoding && encoding !== 'identity') return response;
  // ASSETS can omit Content-Length inside the Worker even when its public
  // response includes it. Only the build-verified current reel has a fallback.
  const size = lengthHeader === null ? verifiedSize : Number(lengthHeader);
  if (size === undefined) return response;
  if (!Number.isSafeInteger(size) || size < 0) return response;
  if (lengthHeader === null) {
    const headers = new Headers(response.headers);
    headers.set('Content-Length', String(size));
    headers.set('Accept-Ranges', 'bytes');
    response = new Response(response.body, { status: response.status, headers });
  }
  if (request.method !== 'GET' || !rangeHeader || !response.body || !matchesIfRange(request.headers.get('If-Range'), response.headers)) return response;
  const range = parseRange(rangeHeader, size);
  if (!range) return response;
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  if (range === 'unsatisfiable') {
    await response.body.cancel();
    headers.set('Content-Range', `bytes */${size}`);
    headers.set('Content-Length', '0');
    headers.set('Cache-Control', 'no-store');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('Content-Length', String(range.end - range.start + 1));
  return new Response(sliceStream(response.body, range), { status: 206, headers });
}
