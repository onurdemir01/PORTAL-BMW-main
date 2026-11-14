# syntax=docker/dockerfile:1

FROM node:22.22-alpine AS builder
WORKDIR /build

COPY package.json package-lock.json ./
COPY gelistirme/package.json gelistirme/package-lock.json ./gelistirme/
COPY scripts/ ./scripts/

RUN npm ci --prefix gelistirme --ignore-scripts --no-audit --no-fund \
  && rm -rf node_modules \
  && ln -s gelistirme/node_modules node_modules

COPY . .

RUN npm run build \
  && npm run paket -- --cikti /out/app --derleme-yok

FROM node:22.22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5055 \
    LOG_DIR=/tmp/bmw-logs \
    LOG_TO_STDOUT=1

COPY --from=builder /out/app/package.json /out/app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force \
  && mkdir -p /tmp/bmw-logs \
  && chown node:node /tmp/bmw-logs

COPY --from=builder /out/app ./

USER node
EXPOSE 5055

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5055) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.cjs"]
