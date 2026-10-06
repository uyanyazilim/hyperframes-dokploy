# HyperFrames — Dokploy production image (local Docker render only)
# Base per spec: node:22-bookworm-slim + system deps copied from Dockerfile.test
FROM node:22-bookworm-slim

# System dependencies (copied from Dockerfile.test)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    git \
    ffmpeg \
    chromium \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libcups2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    libgtk-3-0 \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-noto-core \
    fonts-noto-extra \
    fonts-noto-ui-core \
    fonts-freefont-ttf \
    fonts-dejavu-core \
    fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && fc-cache -fv

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CONTAINER=true

RUN npx --yes @puppeteer/browsers install chrome-headless-shell@148.0.7778.167 \
      --path /opt/puppeteer \
    && CHS="$(find /opt/puppeteer/chrome-headless-shell -name chrome-headless-shell -type f | head -n1)" \
    && mkdir -p /opt/chrome \
    && ln -sf "$CHS" /opt/chrome/chrome-headless-shell \
    && /opt/chrome/chrome-headless-shell --version

ENV HYPERFRAMES_CHROME_PATH=/opt/chrome/chrome-headless-shell
ENV PRODUCER_HEADLESS_SHELL_PATH=/opt/chrome/chrome-headless-shell

RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.13"
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

RUN npm install -g hyperframes@latest \
    && hyperframes --version \
    && ffmpeg -version | head -n1 \
    && chromium --version \
    && node --version

RUN mkdir -p /app/video /app/renders

COPY server.js /app/server.js

ENV PORT=3002
ENV PREVIEW_PORT=3102
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-3002}/health || exit 1

CMD ["node", "/app/server.js"]
