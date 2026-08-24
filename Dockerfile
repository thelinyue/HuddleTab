FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY docker-entrypoint.sh /usr/local/bin/huddletab-entrypoint
RUN mkdir -p /data/uploads /data/backups /data/config \
  && chmod 755 /usr/local/bin/huddletab-entrypoint
EXPOSE 5660
ENTRYPOINT ["/usr/local/bin/huddletab-entrypoint"]
CMD ["npm", "run", "start:container"]
