FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

RUN test -f dist/main.js && echo "dist/main.js exists" || (echo "BUILD FAILED: dist/main.js not found" && exit 1)

EXPOSE 3001

CMD ["node", "dist/main"]
