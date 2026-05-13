# Etapa 1: build de Angular
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Etapa 2: nginx sirve los archivos estáticos
FROM nginx:alpine

COPY --from=builder /app/dist/frontend-paramosense/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
