import { createServer } from 'node:http';
import { env } from 'node:process';
import { handler } from './build/handler.js';
import { crossOriginIsolationHeaders } from './cross-origin-isolation.js';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = '3000';

const host = env.HOST ?? DEFAULT_HOST;
const port = Number(env.PORT ?? DEFAULT_PORT);

const headers = crossOriginIsolationHeaders(env);

const server = createServer((req, res) => {
  for (const [name, value] of Object.entries(headers))
    res.setHeader(name, value);

  handler(req, res);
});

server.listen(port, host, () => {
  console.log(`Listening on ${host}:${port}`);
});
