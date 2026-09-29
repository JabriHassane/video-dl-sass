# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_API_URL=http://localhost:8080
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginx:1.27-alpine

# Self-signed cert baked in at build time — same pattern as MyPortfolio and
# azwebsite: no public hostname is reachable here for a real ACME cert,
# cloudflared skips validation with "No TLS Verify" instead (see DEPLOY.md).
# IP SAN covers direct Tailscale access; CN/DNS SAN covers cloudflared's
# "localhost:8445" service URL.
RUN apk add --no-cache openssl \
    && mkdir -p /etc/nginx/certs \
    && openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /etc/nginx/certs/selfsigned.key \
        -out /etc/nginx/certs/selfsigned.crt \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:100.103.213.104" \
    && apk del openssl

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 443
