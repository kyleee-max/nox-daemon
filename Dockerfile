FROM node:20-alpine

LABEL maintainer="YoruSec <yorusec@github>"
LABEL description="YoruSec Nox Daemon"

# Install deps untuk node-pty
RUN apk add --no-cache python3 make g++ docker-cli

WORKDIR /app

COPY package*.json ./
RUN npm install --production && npm cache clean --force

COPY . .

RUN mkdir -p /var/lib/yorusec/bots \
             /var/lib/yorusec/backups \
             /var/log/yorusec-nox

EXPOSE 8080

CMD ["node", "src/app.js"]
