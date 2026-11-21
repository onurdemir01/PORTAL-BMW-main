# syntax=docker/dockerfile:1

FROM node:22.23.4-alpine AS builder
WORKDIR /build
# Paketlerin kurulum betikleri hicbir npm komutunda calismaz (tedarik zinciri; Sonar docker:S6505).
ENV npm_config_ignore_scripts=true

COPY package.json package-lock.json ./
COPY gelistirme/package.json gelistirme/package-lock.json ./gelistirme/
COPY scripts/ ./scripts/

RUN npm ci --ignore-scripts --prefix=gelistirme --no-audit --no-fund \
  && rm -rf node_modules \
  && ln -s gelistirme/node_modules node_modules

# Yalniz derlemenin ve paketin okudugu yollar (scripts/paket.cjs DAHIL + vite girdileri). `COPY . .`
# baglamdaki her seyi alirdi (Sonar docker:S6470); .dockerignore ikinci kat olarak kalir.
COPY index.html vite.config.ts tsconfig.json tsconfig.server-check.json README.md .env.example ./
COPY src/ ./src/
COPY public/ ./public/
COPY shared/ ./shared/
COPY server/ ./server/
COPY deploy/ ./deploy/
COPY docs/ ./docs/

RUN npm run build \
  && npm run paket -- --cikti /out/app --derleme-yok

FROM node:22.23.4-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5055 \
    LOG_DIR=/tmp/bmw-logs \
    LOG_TO_STDOUT=1

COPY --from=builder /out/app/package.json /out/app/package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund \
  && npm cache clean --force \
  && mkdir -p /tmp/bmw-logs \
  && chown node:node /tmp/bmw-logs

COPY --from=builder /out/app ./
# Uygulamanin yazdigi dizinler (LogX staging / fallback) node kullanicisina ait olmali; kok dosya
# sistemi salt okunur calistirilacaksa bu ikisi birim (volume) olarak baglanir.
RUN mkdir -p data server/data && chown node:node data server/data

USER node
EXPOSE 5055

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5055) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.cjs"]
