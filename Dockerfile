FROM node:22-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 gcc default-jdk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package*.json ./backend/
RUN npm --prefix backend ci --omit=dev
COPY frontend/package*.json ./frontend/
RUN npm --prefix frontend ci
COPY frontend ./frontend
RUN npm --prefix frontend run build
COPY backend ./backend

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000
CMD ["node", "backend/src/server.js"]
