FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=5660
WORKDIR /app

RUN mkdir -p /data/uploads

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src/server/db/migrate.ts ./src/server/db/migrate.ts
COPY --from=build /app/src/server/db/factory.ts ./src/server/db/factory.ts
COPY --from=build /app/docker/entrypoint.sh ./docker/entrypoint.sh

RUN sed -i 's/\r$//' ./docker/entrypoint.sh \
  && chmod +x ./docker/entrypoint.sh

EXPOSE 5660

ENTRYPOINT ["/app/docker/entrypoint.sh"]
