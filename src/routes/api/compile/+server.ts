import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { enqueueCompile } from '$lib/server/compileQueue';
import type { CompileRequest } from '$lib/compiler/types';
import type { RequestHandler } from './$types';

const MAX_SOURCE_BYTES = Number(process.env.KRIOL_MAX_SOURCE_BYTES ?? 128 * 1024);
const ALLOWED_ORIGINS = (process.env.KRIOL_ALLOWED_ORIGINS ?? 'https://play.kriol.dev')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const REQUIRE_FETCH_METADATA = process.env.KRIOL_REQUIRE_FETCH_METADATA !== 'false';

function isAllowedRequest(request: Request) {
  if (dev)
    return true;

  const origin = request.headers.get('origin');
  if (!origin || !ALLOWED_ORIGINS.includes(origin))
    return false;

  const fetchSite = request.headers.get('sec-fetch-site');
  if (!fetchSite)
    return !REQUIRE_FETCH_METADATA;

  return fetchSite === 'same-origin' || fetchSite === 'none';
}

function forbiddenResponse() {
  return json(
    {
      ok: false,
      mode: 'backend',
      diagnostics: ['Compile requests are only accepted from the Kriol playground site.'],
      elapsedMs: 0
    },
    { status: 403 }
  );
}

export const OPTIONS: RequestHandler = async ({ request }) => {
  if (!isAllowedRequest(request))
    return forbiddenResponse();

  return new Response(null, { status: 204 });
};

export const POST: RequestHandler = async ({ request }) => {
  if (!isAllowedRequest(request))
    return forbiddenResponse();

  let body: CompileRequest;
  try {
    body = (await request.json()) as CompileRequest;
  } catch {
    return json(
      {
        ok: false,
        mode: 'backend',
        diagnostics: ['Expected a JSON compile request.'],
        elapsedMs: 0
      },
      { status: 400 }
    );
  }

  if (body.target !== 'wasm32-wasi') {
    return json(
      {
        ok: false,
        mode: 'backend',
        diagnostics: ['Only wasm32-wasi compilation is supported by the playground backend.'],
        elapsedMs: 0
      },
      { status: 400 }
    );
  }

  if (typeof body.source !== 'string' || body.source.trim() === '') {
    return json(
      {
        ok: false,
        mode: 'backend',
        diagnostics: ['Source code is required.'],
        elapsedMs: 0
      },
      { status: 400 }
    );
  }

  if (new TextEncoder().encode(body.source).byteLength > MAX_SOURCE_BYTES) {
    return json(
      {
        ok: false,
        mode: 'backend',
        diagnostics: [`Source is too large for the playground limit of ${MAX_SOURCE_BYTES} bytes.`],
        elapsedMs: 0
      },
      { status: 413 }
    );
  }

  const response = await enqueueCompile(body.source);
  return json(response, { status: response.ok ? 200 : 400 });
};
