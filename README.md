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
```

## Container

Build the deploy image from this project directory. The compiler is downloaded
from a release tarball and smoke-tested during the image build:

```sh
docker build \
  --build-arg KRIOL_COMPILER_URL='https://github.com/kriol-lang/kriol/releases/download/v1.7.8-alpha%2Bbuild2/kriol-v1.7.8-alpha+build2-linux-x86_64.tar.xz' \
  -t kriol-playground .
docker run --rm -p 3000:3000 kriol-playground
```

The image runs the web app as an unprivileged user. Compile requests are queued,
written to private temporary directories, and killed if they exceed the timeout.

To run the same container setup in dev mode, build the `dev` target and expose
Vite's dev-server port:

```sh
docker build \
  --target dev \
  --build-arg KRIOL_COMPILER_URL='https://github.com/kriol-lang/kriol/releases/download/v1.7.8-alpha%2Bbuild2/kriol-v1.7.8-alpha+build2-linux-x86_64.tar.xz' \
  -t kriol-playground-dev .
docker run --rm -p 5173:5173 kriol-playground-dev
```

Open `http://localhost:5173`. Because this runs `npm run dev`, the compile API
uses SvelteKit dev mode and does not enforce the production origin guard.

For deployed production builds, compile requests are accepted only from
`KRIOL_ALLOWED_ORIGINS`, which defaults to `https://play.kriol.dev`. Set a
comma-separated value if the deployed playground is served from another origin.

## Runtime

The browser runner currently supports the WASI calls needed by simple Kriol
programs that print to stdout/stderr and exit. Filesystem and stdin operations
are stubbed for now.

## Compiler Shape

The UI calls `POST /api/compile` through `BackendCompiler`.
