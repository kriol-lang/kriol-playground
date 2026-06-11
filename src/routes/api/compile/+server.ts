import { json } from '@sveltejs/kit';
import { enqueueCompile } from '$lib/server/compileQueue';
import type { CompileRequest } from '$lib/compiler/types';
import type { RequestHandler } from './$types';

const MAX_SOURCE_BYTES = Number(process.env.KRIOL_MAX_SOURCE_BYTES ?? 128 * 1024);

export const POST: RequestHandler = async ({ request }) => {
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
