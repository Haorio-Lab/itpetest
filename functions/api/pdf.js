const manifestPath = "/pdf-chunks/manifest.json";

let cachedManifest;

const pdfHeaders = {
  "content-type": "application/pdf",
  "accept-ranges": "bytes",
  "cache-control": "public, max-age=86400",
};

export async function onRequestGet({ request, env }) {
  return handlePdfRequest(request, env, false);
}

export async function onRequestHead({ request, env }) {
  return handlePdfRequest(request, env, true);
}

async function handlePdfRequest(request, env, headOnly) {
  const url = new URL(request.url);
  const file = url.searchParams.get("file") || "";
  const manifest = await readManifest(request, env);
  const entry = manifest.files?.[file];

  if (!entry) {
    return new Response("PDF not found", { status: 404 });
  }

  const range = parseRange(request.headers.get("range"), entry.size);
  if (range === false) {
    return new Response("Invalid range", {
      status: 416,
      headers: { "content-range": `bytes */${entry.size}` },
    });
  }

  const headers = new Headers(pdfHeaders);
  headers.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(file)}`);

  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${entry.size}`);
    headers.set("content-length", String(range.end - range.start + 1));
    return new Response(headOnly ? null : streamEntry(request, env, entry, range), { status: 206, headers });
  }

  headers.set("content-length", String(entry.size));
  return new Response(headOnly ? null : streamEntry(request, env, entry, { start: 0, end: entry.size - 1 }), {
    status: 200,
    headers,
  });
}

async function readManifest(request, env) {
  if (cachedManifest) return cachedManifest;
  const response = await env.ASSETS.fetch(new URL(manifestPath, request.url));
  if (!response.ok) throw new Error("PDF manifest is missing");
  cachedManifest = await response.json();
  return cachedManifest;
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return false;

  let start;
  let end;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return false;
  return { start, end: Math.min(end, size - 1) };
}

function streamEntry(request, env, entry, range) {
  return new ReadableStream({
    async start(controller) {
      let offset = 0;

      try {
        for (const part of entry.parts) {
          const partStart = offset;
          const partEnd = offset + part.size - 1;
          offset += part.size;

          if (partEnd < range.start || partStart > range.end) continue;

          const overlapStart = Math.max(range.start, partStart);
          const overlapEnd = Math.min(range.end, partEnd);
          const relativeStart = overlapStart - partStart;
          const relativeEnd = overlapEnd - partStart;
          const response = await fetchAssetPart(request, env, part.path, relativeStart, relativeEnd);
          if (!response.ok && response.status !== 206) throw new Error(`PDF chunk fetch failed: ${response.status}`);

          let bytes = new Uint8Array(await response.arrayBuffer());
          if (response.status !== 206 && (relativeStart > 0 || relativeEnd < part.size - 1)) {
            bytes = bytes.slice(relativeStart, relativeEnd + 1);
          }
          controller.enqueue(bytes);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function fetchAssetPart(request, env, path, start, end) {
  const assetUrl = new URL(path, request.url);
  const headers = new Headers();
  if (start > 0 || end >= start) {
    headers.set("range", `bytes=${start}-${end}`);
  }
  return env.ASSETS.fetch(new Request(assetUrl, { headers }));
}
