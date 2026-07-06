FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json vite.config.ts ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY ui ./ui
RUN bun run build

FROM oven/bun:1.3
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY --from=build /app/ui/dist ./ui/dist
ENV NODE_ENV=production DATA_DIR=/app/data PORT=4620
EXPOSE 4620
CMD ["bun", "run", "start"]
