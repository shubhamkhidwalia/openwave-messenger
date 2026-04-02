FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production
COPY backend/ ./
COPY frontend/ ./frontend/
RUN mkdir -p data/uploads data/tmp
ENV PORT=4000 NODE_ENV=production
EXPOSE 4000
CMD ["node", "server.js"]
