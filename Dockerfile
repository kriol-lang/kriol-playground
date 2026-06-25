ARG UBUNTU_TAG=resolute
ARG KRIOL_TAG=v1.9.1-alpha+build1
ARG KRIOL_SHA256="1165f328c130919fbd0ff7712b79478c4f6a219bca5a0f7c17e1036e1e952776"

FROM ubuntu:${UBUNTU_TAG} AS build

ARG KRIOL_TAG
ARG KRIOL_SHA256
ENV KRIOL_URL=https://github.com/kriol-lang/kriol/releases/download/${KRIOL_TAG}/kriol-${KRIOL_TAG}-linux-x86_64.tar.xz
ENV DEBIAN_FRONTEND=noninteractive
ENV KRIOL_BIN=/opt/kriol/bin/kriol
ENV KRIOL_VERSION_FILE=/opt/kriol/VERSION
ENV LD_LIBRARY_PATH=/opt/kriol/lib:/opt/kriol/lib64

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        nodejs \
        npm \
        xz-utils \
        lld-20 \
    && wasm-ld-20 --version \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /tmp/kriol-install /opt/kriol/bin \
    && curl -fsSL "${KRIOL_URL}" -o /tmp/kriol.tar.xz \
    && if test -n "${KRIOL_SHA256}"; then echo "${KRIOL_SHA256}  /tmp/kriol.tar.xz" | sha256sum -c -; fi \
    && tar -xJf /tmp/kriol.tar.xz -C /tmp/kriol-install \
    && compiler_path="$(find /tmp/kriol-install -type f -name kriol -perm /111 | head -n 1)" \
    && test -n "${compiler_path}" \
    && compiler_dir="$(dirname "${compiler_path}")" \
    && if test "$(basename "${compiler_dir}")" = "bin"; then compiler_prefix="$(dirname "${compiler_dir}")"; else compiler_prefix="${compiler_dir}"; fi \
    && cp -a "${compiler_prefix}/." /opt/kriol/ \
    && if ! test -x "${KRIOL_BIN}"; then cp "${compiler_path}" "${KRIOL_BIN}"; fi \
    && test -x "${KRIOL_BIN}" \
    && chmod 0755 "${KRIOL_BIN}" \
    && "${KRIOL_BIN}" --version > "${KRIOL_VERSION_FILE}" \
    && cat "${KRIOL_VERSION_FILE}" \
    && printf 'fn inisiu() {\n    mostran("Kuale, Mundu!");\n}\n' > /tmp/smoke.kriol \
    && "${KRIOL_BIN}" /tmp/smoke.kriol --target wasm32-wasi -o /tmp/smoke.wasm --ignore-extension \
    && test -s /tmp/smoke.wasm \
    && rm -rf /tmp/kriol-install /tmp/kriol.tar.xz /tmp/smoke.kriol /tmp/smoke.wasm

WORKDIR /src

COPY package.json package-lock.json ./
RUN npm install

COPY . .

FROM build AS dev

ENV HOST=0.0.0.0
ENV PORT=3000
ENV KRIOL_COMPILE_QUEUE_SIZE=8
ENV KRIOL_COMPILE_TIMEOUT_MS=10000
ENV KRIOL_MAX_SOURCE_BYTES=131072
ENV KRIOL_COMPILE_OUTPUT_LIMIT_BYTES=65536

EXPOSE 3000

CMD ["npm", "run", "dev"]

FROM build AS production-build

RUN npm run build \
    && npm prune --omit=dev

FROM ubuntu:${UBUNTU_TAG} AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV HOST=0.0.0.0
ENV PORT=3000
ENV KRIOL_BIN=/opt/kriol/bin/kriol
ENV KRIOL_VERSION_FILE=/opt/kriol/VERSION
ENV LD_LIBRARY_PATH=/opt/kriol/lib:/opt/kriol/lib64
ENV KRIOL_COMPILE_QUEUE_SIZE=8
ENV KRIOL_COMPILE_TIMEOUT_MS=10000
ENV KRIOL_MAX_SOURCE_BYTES=131072
ENV KRIOL_COMPILE_OUTPUT_LIMIT_BYTES=65536

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        nodejs \
        lld-20 \
    && wasm-ld-20 --version \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app

COPY --from=build /opt/kriol /opt/kriol
COPY --from=production-build /src/build /app/build
COPY --from=production-build /src/node_modules /app/node_modules
COPY --from=production-build /src/package.json /app/package.json
COPY --from=production-build /src/cross-origin-isolation.js /app/cross-origin-isolation.js
COPY --from=production-build /src/server.js /app/server.js

RUN chown -R app:app /app \
    && test -s "${KRIOL_VERSION_FILE}" \
    && cat "${KRIOL_VERSION_FILE}"

WORKDIR /app

USER app

EXPOSE 3000

CMD ["node", "server.js"]
