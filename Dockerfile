FROM node:24-bookworm-slim AS frontend-build
WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM rust:1.97-bookworm AS server-build
WORKDIR /build/server

COPY server/ ./
RUN cargo build --release --locked

FROM debian:bookworm-slim AS runtime

ARG APP_VERSION=dev

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl gosu tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && install -d /app/frontend/dist /data

COPY --from=server-build /build/server/target/release/huddletab /usr/local/bin/huddletab
COPY --from=frontend-build /build/frontend/dist/ /app/frontend/dist/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

ENV APP_VERSION=$APP_VERSION PUID=10001 PGID=10001 RUST_LOG=huddletab_server=info TZ=Asia/Shanghai
WORKDIR /app
EXPOSE 5660

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["serve", "--static-dir", "/app/frontend/dist"]
