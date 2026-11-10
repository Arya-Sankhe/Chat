# The rebuilt web app (clients/web). Its public/ folder links into the root public/.
FROM node:24-alpine AS web
WORKDIR /src
COPY clients/package.json clients/package-lock.json clients/tsconfig.base.json ./clients/
COPY clients/shared/package.json ./clients/shared/
COPY clients/web/package.json ./clients/web/
COPY clients/mobile/package.json ./clients/mobile/
RUN cd clients && npm ci --ignore-scripts --no-audit --no-fund -w @klui/shared -w @klui/web --include-workspace-root=false
COPY public ./public
COPY clients/shared ./clients/shared
COPY clients/web ./clients/web
RUN cd clients && npm run build -w @klui/web

FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY --from=web /src/clients/web/dist ./clients/web/dist
COPY scripts ./scripts
COPY skills ./skills
# The deck writer and editor validate DeckSpecs with the worker's deck modules.
COPY worker/deck ./worker/deck
COPY worker/doc/spec.js worker/doc/themes.js ./worker/doc/

# Fingerprint shipped app contents so every code/content change produces a
# new client-visible build.
RUN find server public clients/web/dist -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1 > .build-id

# The rebuilt web app; WEB_CLIENT=legacy in .env serves public/ again without a rebuild.
ENV WEB_CLIENT=new

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
