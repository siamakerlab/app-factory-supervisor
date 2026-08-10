FROM node:24-bookworm AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY index.html vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-bookworm AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV TOOLCHAIN_ROOT=/app/data/toolchains
ENV ANDROID_HOME=/app/data/toolchains/android-sdk
ENV ANDROID_SDK_ROOT=/app/data/toolchains/android-sdk
ENV ANDROID_AVD_HOME=/app/data/toolchains/avd
ENV PATH=/app/data/toolchains/android-sdk/platform-tools:/app/data/toolchains/android-sdk/cmdline-tools/latest/bin:/app/data/toolchains/android-sdk/emulator:/app/data/toolchains/gradle/bin:$PATH

COPY package.json package-lock.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client python3 unzip zip default-jdk-headless imagemagick webp jq xz-utils chromium \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g \
    @openai/codex@0.147.0 \
    mobile-docs-mcp@0.2.0 \
    @upstash/context7-mcp@4.0.0 \
    @mobilenext/mobile-mcp@1.0.2 \
    @playwright/mcp@0.0.79 \
    @modelcontextprotocol/server-memory@2026.7.4 \
    @guanxiong/mcp-server-time@1.0.0 \
  && npm ci --omit=dev \
  && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data /app/projects \
  && chown -R node:node /app/data /app/projects

EXPOSE 3000

CMD ["npm", "run", "start"]
