FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY backend/package*.json ./
RUN npm install --production

COPY backend/ ./
COPY frontend/ ./frontend/

RUN mkdir -p data/uploads

ENV PORT=4000
ENV NODE_ENV=production

EXPOSE 4000

CMD ["node", "server.js"]
