# Production Multi-Stage Dockerfile for shoRDs Research Intelligence OS
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx tsc --noEmit

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production --legacy-peer-deps
COPY --from=builder /app ./
EXPOSE 4000
CMD ["node", "backend/start_local_server.js"]
