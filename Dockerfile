ARG UBUNTU_TAG=resolute
ARG KRIOL_COMPILER_URL=https://github.com/kriol-lang/kriol/releases/download/v1.7.8-alpha%2Bbuild2/kriol-v1.7.8-alpha+build2-linux-x86_64.tar.xz

FROM ubuntu:${UBUNTU_TAG} AS build

ARG KRIOL_COMPILER_URL
ENV DEBIAN_FRONTEND=noninteractive
ENV KRIOL_BIN=/opt/kriol/bin/kriol
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
    && curl -fsSL "${KRIOL_COMPILER_URL}" -o /tmp/kriol.tar.xz \
    && tar -xJf /tmp/kriol.tar.xz -C /tmp/kriol-install \
    && compiler_path="$(find /tmp/kriol-install -type f -name kriol -perm /111 | head -n 1)" \
    && test -n "${compiler_path}" \
    && compiler_dir="$(dirname "${compiler_path}")" \
    && if test "$(basename "${compiler_dir}")" = "bin"; then compiler_prefix="$(dirname "${compiler_dir}")"; else compiler_prefix="${compiler_dir}"; fi \
    && cp -a "${compiler_prefix}/." /opt/kriol/ \
    && if ! test -x "${KRIOL_BIN}"; then cp "${compiler_path}" "${KRIOL_BIN}"; fi \
    && test -x "${KRIOL_BIN}" \
    && chmod 0755 "${KRIOL_BIN}" \
    && "${KRIOL_BIN}" --version \
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
ENV PORT=5173
ENV KRIOL_COMPILE_QUEUE_SIZE=8
ENV KRIOL_COMPILE_TIMEOUT_MS=10000
ENV KRIOL_MAX_SOURCE_BYTES=131072
ENV KRIOL_COMPILE_OUTPUT_LIMIT_BYTES=65536

EXPOSE 5173

CMD ["npm", "run", "dev"]

FROM build AS production-build

RUN npm run build \
    && npm prune --omit=dev

FROM ubuntu:${UBUNTU_TAG} AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV HOST=0.0.0.0
ENV PORT=3000
ENV KRIOL_BIN=/opt/kriol/bin/kriol
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

RUN chown -R app:app /app \
    && "${KRIOL_BIN}" --version

WORKDIR /app

USER app

EXPOSE 3000

CMD ["node", "build"]
