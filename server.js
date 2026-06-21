import { createServer } from 'node:http';
import { env } from 'node:process';
import { handler } from './build/handler.js';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = '3000';
const DEFAULT_COOP = 'same-origin';
const DEFAULT_COEP = 'credentialless';
const DEFAULT_CORP = '';

const host = env.HOST ?? DEFAULT_HOST;
const port = Number(env.PORT ?? DEFAULT_PORT);

function crossOriginIsolationHeaders() {
  const coop = env.KRIOL_CROSS_ORIGIN_OPENER_POLICY ?? DEFAULT_COOP;
  const coep = env.KRIOL_CROSS_ORIGIN_EMBEDDER_POLICY ?? DEFAULT_COEP;
  const corp = env.KRIOL_CROSS_ORIGIN_RESOURCE_POLICY ?? DEFAULT_CORP;

  return {
    ...(coop ? { 'Cross-Origin-Opener-Policy': coop } : {}),
    ...(coep ? { 'Cross-Origin-Embedder-Policy': coep } : {}),
    ...(corp ? { 'Cross-Origin-Resource-Policy': corp } : {})
  };
}

const headers = crossOriginIsolationHeaders();

const server = createServer((req, res) => {
  for (const [name, value] of Object.entries(headers))
    res.setHeader(name, value);

  handler(req, res);
});

server.listen(port, host, () => {
  console.log(`Listening on ${host}:${port}`);
});
