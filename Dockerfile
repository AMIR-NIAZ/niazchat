# syntax=docker/dockerfile:1

ARG NODE_VERSION=22

# ---- deps: full dependency tree used to compile the app ----------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
# Toolchain for native modules (bcrypt) when no prebuilt binary is available.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript to dist/ -------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: production dependencies only --------------------------------
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# HTTP/WebSocket port (overridable at build time).
ARG APP_PORT=3000
ENV PORT=${APP_PORT}

RUN apk add --no-cache tini

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node docker/entrypoint.sh ./docker/entrypoint.sh

# Local upload directory used by ServeStaticModule and FileContentHandler.
RUN mkdir -p uploads/avatars uploads/messages \
    && chmod +x docker/entrypoint.sh \
    && chown -R node:node /app

USER node

EXPOSE ${APP_PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "./docker/entrypoint.sh"]
