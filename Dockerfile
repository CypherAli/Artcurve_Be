FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

RUN npm run build
RUN npm prune --omit=dev --legacy-peer-deps

RUN echo "=== dist contents ===" && find dist -name "*.js" 2>/dev/null | head -20 || echo "dist empty"

RUN test -f dist/main.js && echo "dist/main.js exists" || (echo "BUILD FAILED: dist/main.js not found" && exit 1)

EXPOSE 3001

# Chạy bằng user không phải root (image node:alpine có sẵn user `node`) — giảm blast radius nếu app bị exploit
USER node

CMD ["node", "dist/main"]
