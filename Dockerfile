FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

COPY . .

RUN npm run build

RUN echo "=== dist contents ===" && find dist -name "*.js" 2>/dev/null | head -20 || echo "dist empty"

RUN test -f dist/main.js && echo "dist/main.js exists" || (echo "BUILD FAILED: dist/main.js not found" && exit 1)

EXPOSE 3001

CMD ["node", "dist/main"]
