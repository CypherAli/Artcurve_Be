FROM node:20-alpine

WORKDIR /app

# Install all deps (including devDeps for nest CLI)
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy source
COPY . .

# Build TypeScript
RUN ./node_modules/.bin/nest build

# Verify dist exists
RUN ls -la dist/ && echo "Build OK"

EXPOSE 3001

CMD ["node", "dist/main"]
