FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_GOVERNANCE_CONTRACT=""
ARG VITE_LEDGER_CHAIN_ID="1337"
ARG VITE_LEDGER_WALLET_RPC=""
ENV VITE_GOVERNANCE_CONTRACT=$VITE_GOVERNANCE_CONTRACT \
    VITE_LEDGER_CHAIN_ID=$VITE_LEDGER_CHAIN_ID \
    VITE_LEDGER_WALLET_RPC=$VITE_LEDGER_WALLET_RPC
RUN npm run build:web

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8088
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/data ./data
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/web/dist ./web/dist
USER node
EXPOSE 8088
STOPSIGNAL SIGTERM
CMD ["node", "server/http/start.ts"]
