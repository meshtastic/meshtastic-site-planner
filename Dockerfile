# Static site image: builds the frontend (the RF engine ships as committed
# WebAssembly in src/engine/generated/) and serves it with nginx. No Python,
# Redis, or SPLAT! runtime - all computation happens in the browser.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
