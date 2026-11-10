# Build the existing staff console from its owning Back Office package.
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts/build-web.ts ./scripts/build-web.ts
COPY shared ./shared
COPY web/src ./web/src
COPY web/public ./web/public
COPY web/index.html ./web/index.html
ARG VITE_GOVERNANCE_CONTRACT=""
ARG VITE_LEDGER_CHAIN_ID="1337"
ARG VITE_LEDGER_WALLET_RPC=""
ENV VITE_GOVERNANCE_CONTRACT=$VITE_GOVERNANCE_CONTRACT \
    VITE_LEDGER_CHAIN_ID=$VITE_LEDGER_CHAIN_ID \
    VITE_LEDGER_WALLET_RPC=$VITE_LEDGER_WALLET_RPC
RUN npm run build:web

FROM nginx:1.27-alpine
COPY --from=build /src/web/dist /srv/console
