# This file was written in 2026 by the Faculty of Informatics and Information
# Technologies for the Professional License Registry.

FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

EXPOSE 8090

CMD ["node", "src/server.js"]
