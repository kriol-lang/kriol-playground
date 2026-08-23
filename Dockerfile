ARG DEBIAN_TAG=trixie
ARG LLVM_VERSION=20
ARG KRIOL_TAG=v1.9.2-alpha+build1
ARG KRIOL_SHA256="ef62d6a7bf53e784196723ce2d195123f243b3fc81b4f319dc8d71f5873981fc"

# kriol's release binary (built on Ubuntu) only needs glibc up to 2.38, so it
# runs fine here despite this stage being Debian — but the release still
# shells out to wasm-ld at runtime, which Ubuntu's LLVM 20 package needs
# glibc 2.42 for. apt.llvm.org publishes LLVM 20 built against Debian's own
# glibc, so pull wasm-ld from there instead.
FROM debian:${DEBIAN_TAG} AS kriol-fetch

ARG DEBIAN_TAG
ARG LLVM_VERSION
ARG KRIOL_TAG
ARG KRIOL_SHA256
ENV KRIOL_URL=https://github.com/kriol-lang/kriol/releases/download/${KRIOL_TAG}/kriol-${KRIOL_TAG}-linux-x86_64.tar.xz
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        wget \
        xz-utils \
    && wget -qO- https://apt.llvm.org/llvm-snapshot.gpg.key | gpg --dearmor -o /usr/share/keyrings/llvm.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/llvm.gpg] https://apt.llvm.org/${DEBIAN_TAG}/ llvm-toolchain-${DEBIAN_TAG}-${LLVM_VERSION} main" \
        > /etc/apt/sources.list.d/llvm.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends lld-${LLVM_VERSION} \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /tmp/kriol-install /opt/kriol \
    && curl -fsSL "${KRIOL_URL}" -o /tmp/kriol.tar.xz \
    && if test -n "${KRIOL_SHA256}"; then echo "${KRIOL_SHA256}  /tmp/kriol.tar.xz" | sha256sum -c -; fi \
    && tar -xJf /tmp/kriol.tar.xz -C /tmp/kriol-install \
    && compiler_path="$(find /tmp/kriol-install -type f -name kriol -perm /111 | head -n 1)" \
    && test -n "${compiler_path}" \
    && cp -a "${compiler_path}" /opt/kriol/kriol \
    && chmod 0755 /opt/kriol/kriol \
    && /opt/kriol/kriol --version > /opt/kriol/VERSION \
    && cat /opt/kriol/VERSION \
    && printf 'fn inisiu() {\n    mostran("Kuale, Mundu!");\n}\n' > /tmp/smoke.kriol \
    && PATH="/usr/bin:${PATH}" /opt/kriol/kriol /tmp/smoke.kriol --target wasm32-wasi -o /tmp/smoke.wasm --ignore-extension \
    && test -s /tmp/smoke.wasm \
    && rm -rf /tmp/kriol-install /tmp/kriol.tar.xz /tmp/smoke.kriol /tmp/smoke.wasm

RUN set -eu; \
    mkdir -p /out; \
    collect() { \
        rbin="$(readlink -f "$1")"; \
        cp -a "$rbin" "/out/$(basename "$2")"; \
        for lib in $(ldd "$rbin" | awk '{print $3}' | grep '^/'); do \
            [ -e "/out/$(basename "$lib")" ] || cp -L "$lib" "/out/$(basename "$lib")"; \
        done; \
    }; \
    collect /opt/kriol/kriol kriol; \
    collect /usr/bin/wasm-ld-${LLVM_VERSION} wasm-ld-${LLVM_VERSION}

FROM debian:${DEBIAN_TAG} AS build

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        nodejs \
        npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

COPY package.json package-lock.json ./
RUN npm install

COPY . .

FROM build AS dev

ENV HOST=0.0.0.0
ENV PORT=3000
ENV KRIOL_BIN=/usr/local/bin/kriol
ENV KRIOL_VERSION_FILE=/opt/kriol/VERSION
ENV KRIOL_COMPILE_QUEUE_SIZE=8
ENV KRIOL_COMPILE_TIMEOUT_MS=10000
ENV KRIOL_MAX_SOURCE_BYTES=131072
ENV KRIOL_COMPILE_OUTPUT_LIMIT_BYTES=65536

COPY --from=kriol-fetch /opt/kriol/kriol /usr/local/bin/kriol
COPY --from=kriol-fetch /opt/kriol/VERSION /opt/kriol/VERSION

EXPOSE 3000

CMD ["npm", "run", "dev"]

FROM build AS production-build

RUN npm run build \
    && npm prune --omit=dev

FROM gcr.io/distroless/nodejs24-debian13 AS runtime

ARG LLVM_VERSION
ENV HOST=0.0.0.0
ENV PORT=3000
ENV KRIOL_BIN=/usr/local/bin/kriol
ENV KRIOL_VERSION_FILE=/opt/kriol/VERSION
ENV KRIOL_COMPILE_QUEUE_SIZE=8
ENV KRIOL_COMPILE_TIMEOUT_MS=10000
ENV KRIOL_MAX_SOURCE_BYTES=131072
ENV KRIOL_COMPILE_OUTPUT_LIMIT_BYTES=65536

COPY --from=kriol-fetch /out/kriol /out/wasm-ld-${LLVM_VERSION} /usr/local/bin/
COPY --from=kriol-fetch /out/*.so* /usr/lib/x86_64-linux-gnu/
COPY --from=kriol-fetch /opt/kriol/VERSION /opt/kriol/VERSION
COPY --from=production-build /src/build /app/build
COPY --from=production-build /src/node_modules /app/node_modules
COPY --from=production-build /src/package.json /app/package.json
COPY --from=production-build /src/cross-origin-isolation.js /app/cross-origin-isolation.js
COPY --from=production-build /src/server.js /app/server.js

WORKDIR /app

USER nonroot

EXPOSE 3000

CMD ["server.js"]
