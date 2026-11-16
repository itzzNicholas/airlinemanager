FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY server ./server
COPY public ./public
COPY servers.json ./servers.json
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1
USER node
CMD ["node", "server/index.js"]
