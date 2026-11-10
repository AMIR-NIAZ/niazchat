# syntax=docker/dockerfile:1
# Development image: dependencies only. Source code is bind-mounted by compose.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine

WORKDIR /app

# Toolchain for native modules (bcrypt) + tini for proper signal handling.
RUN apk add --no-cache python3 make g++ tini ffmpeg \
    && mkdir -p uploads/avatars storage/attachments \
    && chown -R node:node /app

USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

ENV NODE_ENV=development

EXPOSE 3000 9229

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "nest", "start", "--watch", "--debug", "0.0.0.0:9229"]