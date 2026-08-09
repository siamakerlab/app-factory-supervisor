FROM node:24-bookworm AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY index.html vite.config.ts ./
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
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data /app/projects \
  && chown -R node:node /app/data /app/projects

EXPOSE 3000

CMD ["npm", "run", "start"]
