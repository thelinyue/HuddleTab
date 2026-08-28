FROM node:24-bookworm-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /work

COPY package.json package-lock.json ./
RUN npm ci \
  && npm exec -- playwright install --with-deps chromium

COPY . .

CMD ["npm", "exec", "--", "playwright", "test", "tests/e2e/release/four-day-accounting-lifecycle.spec.ts", "--project=desktop-chromium", "--workers=1"]
