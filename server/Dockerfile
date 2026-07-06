FROM oven/bun:1-alpine
WORKDIR /app

# deps first for layer caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY assets ./assets

ENV PORT=8095 \
    DB_PATH=/data/aibadges.db
EXPOSE 8095

# SQLite lives in the mounted /data volume.
CMD ["bun", "run", "src/index.ts"]
