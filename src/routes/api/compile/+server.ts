import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { enqueueCompile, getCompilerVersion } from '$lib/server/compileQueue';
import { checkCompileRateLimit } from '$lib/server/rateLimit';
import type { CompileRequest } from '$lib/compiler/types';
import type { RequestHandler } from './$types';

const MAX_SOURCE_BYTES = Number(process.env.KRIOL_MAX_SOURCE_BYTES ?? 128 * 1024);
const ENABLE_RATE_LIMIT = process.env.KRIOL_COMPILE_RATE_LIMIT !== 'false';
const ALLOWED_ORIGINS = (process.env.KRIOL_ALLOWED_ORIGINS ?? 'https://play.kriol.dev,http://localhost:3000,http://127.0.0.1:3000')
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

function throttledResponse(retryAfterSeconds: number) {
  return json(
    {
      ok: false,
      mode: 'backend',
      diagnostics: ['Too many compile requests. Please wait a moment and try again.'],
      elapsedMs: 0
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds)
      }
    }
  );
}

export const OPTIONS: RequestHandler = async ({ request }) => {
  if (!isAllowedRequest(request))
    return forbiddenResponse();

  return new Response(null, { status: 204 });
};

export const GET: RequestHandler = async () => {
  return json({
    compilerVersion: await getCompilerVersion()
  });
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  if (!isAllowedRequest(request))
    return forbiddenResponse();

  if (ENABLE_RATE_LIMIT) {
    const rateLimit = checkCompileRateLimit(getClientAddress());
    if (!rateLimit.allowed)
      return throttledResponse(rateLimit.retryAfterSeconds);
  }

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
