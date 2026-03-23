FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY backend/package*.json ./
RUN npm install --production

# Copy backend files
COPY backend/ ./

# Copy frontend into the expected location
COPY frontend/ ./frontend/

# Create uploads dir
RUN mkdir -p data/uploads data/tmp

ENV PORT=4000
ENV NODE_ENV=production

EXPOSE 4000

CMD ["node", "server.js"]
