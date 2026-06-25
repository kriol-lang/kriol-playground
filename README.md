# Kriol Playground

SvelteKit playground for compiling Kriol source to `wasm32-wasi`.

The current mode uses a backend compile endpoint backed by the native `kriol`
binary. The returned wasm module can be run in the browser with a small local
WASI preview1 shim that captures stdout and stderr.

## Development

```sh
npm install
npm run dev
```

The compile endpoint allows all requests while SvelteKit is running in dev
mode. This keeps local testing simple and bypasses the deployed-origin guard.

Useful queue knobs:

```sh
KRIOL_COMPILE_QUEUE_SIZE=8
KRIOL_COMPILE_TIMEOUT_MS=10000
KRIOL_MAX_SOURCE_BYTES=131072
KRIOL_COMPILE_OUTPUT_LIMIT_BYTES=65536
KRIOL_COMPILE_RATE_LIMIT=true
KRIOL_COMPILE_RATE_LIMIT_MAX=12
KRIOL_COMPILE_RATE_LIMIT_WINDOW_MS=60000
```

## Container

Build the deploy image from this project directory. The compiler is downloaded
from a release tarball and smoke-tested during the image build:

```sh
docker build -t kriol-play .
docker run --rm -p 3000:3000 kriol-play
```

If a release checksum is available, you can pass it at build time (or set it in the Dockerfile) so the downloaded
compiler archive is verified before extraction:

```sh
docker build --build-arg KRIOL_SHA256=<sha256> -t kriol-play .
```

The image runs the web app as an unprivileged user. Compile requests are queued,
written to private temporary directories, and killed if they exceed the timeout.
The compile API also applies a soft per-client-address rate limit before adding
work to the queue. When deploying behind a reverse proxy, configure SvelteKit's
adapter-node client address headers so the limiter sees the real client IP
instead of the proxy address.

The public playground should also be run with container-level restrictions such
as a read-only root filesystem, a bounded `/tmp` tmpfs, dropped capabilities,
`no-new-privileges`, and CPU, memory, and PID limits. Those controls are part of
the deployment security boundary because the backend accepts untrusted source
and invokes the native compiler.

To run the same container setup in dev mode, build the `dev` target and expose
Vite's dev-server port:

```sh
docker build --target dev -t kriol-play-dev .
docker run --rm -p 5173:5173 kriol-play-dev
```
~
Open `http://localhost:5173`. Because this runs `npm run dev`, the compile API
uses SvelteKit dev mode and does not enforce the production origin guard.

For deployed production builds, compile requests are accepted only from
`KRIOL_ALLOWED_ORIGINS`, which defaults to `https://play.kriol.dev`. Set a
comma-separated value if the deployed playground is served from another origin.

## Runtime

The browser runner currently supports the WASI calls needed by simple Kriol
programs that read stdin, print to stdout/stderr, and exit. When WASI fd 0 is
read, the worker blocks on a `SharedArrayBuffer` stdin channel and the UI polls
shared stdout/stderr buffers plus stdin request state. The "Entrada padrão"
prompt appears only while the program is waiting for a line. This requires
cross-origin isolation, so the production server wrapper and Vite dev/preview
server set COOP/COEP headers. The default COEP policy is `require-corp`, which has the
most consistent browser support for `SharedArrayBuffer` isolation. Override
these headers with
`KRIOL_CROSS_ORIGIN_OPENER_POLICY`, `KRIOL_CROSS_ORIGIN_EMBEDDER_POLICY`, and
`KRIOL_CROSS_ORIGIN_RESOURCE_POLICY` if a host needs a different policy.
The Docker production image starts `server.js`, a thin adapter-node wrapper that
sets the same headers before serving static `/_app/immutable/*` assets such as
worker chunks. Filesystem operations are stubbed for now.

## Compiler Shape

The UI calls `POST /api/compile` through `BackendCompiler`.

## Editor highlighting

The playground editor uses a small CodeMirror stream language in
`src/lib/editor/kriolLanguage.ts`. It follows the same regex-level highlighting
model as the TextMate grammar used by the docs.
