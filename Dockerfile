# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim

# ffmpeg: required by yt-dlp to mux separate video+audio streams into one file.
# curl/ca-certificates/unzip: needed once, to fetch the binaries below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Standalone PyInstaller build of yt-dlp — no system Python required, and
# pinned to an exact version for reproducible builds (bump deliberately).
ARG YTDLP_VERSION=2026.08.19
RUN curl -fL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux" \
      -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Deno: current yt-dlp releases need a JS runtime to solve YouTube's
# player-signature challenge (nsig) — without it, extraction silently
# falls back to a degraded/HLS-only format list. Pinned like yt-dlp above.
ARG DENO_VERSION=v2.9.6
RUN curl -fL "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" \
      -o /tmp/deno.zip \
    && unzip -q /tmp/deno.zip -d /usr/local/bin \
    && chmod a+rx /usr/local/bin/deno \
    && rm /tmp/deno.zip

WORKDIR /app

# Separate dependency layer for build-cache efficiency.
COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

# Run as a non-root, unprivileged user.
RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser \
    && chown -R appuser:appuser /app
USER appuser

ENV NODE_ENV=production \
    YTDLP_BIN=/usr/local/bin/yt-dlp \
    PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
