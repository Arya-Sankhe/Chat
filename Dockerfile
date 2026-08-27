FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY skills ./skills

# Fingerprint shipped app contents so every code/content change produces a
# new client-visible build.
RUN find server public -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1 > .build-id

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
