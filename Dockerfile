# Dockerfile
FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN npx prisma generate

COPY start.sh ./
RUN chmod +x start.sh

EXPOSE 3000

CMD ["sh", "start.sh"]
