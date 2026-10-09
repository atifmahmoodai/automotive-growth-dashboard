FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY frontend frontend
RUN npm run build
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node backend backend
COPY --chown=node:node scripts scripts
COPY --from=build --chown=node:node /app/dist dist
USER node
EXPOSE 3000
CMD ["node","backend/server.js"]
