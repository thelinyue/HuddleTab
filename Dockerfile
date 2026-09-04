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
  && apt-get install --yes --no-install-recommends ca-certificates curl tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 huddletab \
  && useradd --uid 10001 --gid huddletab --no-create-home --shell /usr/sbin/nologin huddletab \
  && install -d -o huddletab -g huddletab /app/frontend/dist /data

COPY --from=server-build /build/server/target/release/huddletab /usr/local/bin/huddletab
COPY --from=frontend-build --chown=huddletab:huddletab /build/frontend/dist/ /app/frontend/dist/

ENV APP_VERSION=$APP_VERSION RUST_LOG=huddletab_server=info TZ=Asia/Shanghai
WORKDIR /app
USER 10001:10001
EXPOSE 5660

ENTRYPOINT ["huddletab"]
CMD ["serve", "--static-dir", "/app/frontend/dist"]
