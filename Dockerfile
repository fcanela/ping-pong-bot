# syntax=docker/dockerfile:1

ARG NODE_VERSION=21
FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV production

WORKDIR /usr/src/app

COPY . .

# Download dependencies as a separate step to take advantage of Docker's caching.
# Leverage a cache mount to /root/.npm to speed up subsequent builds.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev


# Run the application, we run with ts-node directly so the process
# can capture the shutdown signals and shutdown gracefully
CMD node_modules/.bin/ts-node src/index.ts
