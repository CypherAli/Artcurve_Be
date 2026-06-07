FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

# Copy non-TS assets that tsc doesn't include
RUN mkdir -p dist/shared/clickhouse dist/shared/curve-engine \
  && cp src/shared/clickhouse/schema.sql dist/shared/clickhouse/schema.sql \
  && cp src/shared/curve-engine/curve.proto dist/shared/curve-engine/curve.proto

RUN echo "=== dist contents ===" && find dist -name "*.js" 2>/dev/null | head -20 || echo "dist empty"

RUN test -f dist/main.js && echo "dist/main.js exists" || (echo "BUILD FAILED: dist/main.js not found" && exit 1)

EXPOSE 3001

CMD ["node", "dist/main"]
