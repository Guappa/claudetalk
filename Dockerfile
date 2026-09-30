FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
# Claude Code runs commands in the mounted projects with what this image has: git and the CLI, nothing else is assumed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The claude on PATH is the build the Agent SDK ships, so listings and turns run one and the same Claude Code.
RUN ln -s "$(echo /app/node_modules/@anthropic-ai/claude-agent-sdk-linux-*/claude)" /usr/local/bin/claude
COPY --from=build /app/dist ./dist
# Run as uid 1000 by default, the first account on most hosts; another uid passed with --user still finds this home and can write these folders through the root group.
RUN mkdir -p /app/data /projects /home/node/.claude && chown 1000:0 /app /app/data /projects /home/node /home/node/.claude && chmod 775 /app /app/data /projects /home/node /home/node/.claude
USER 1000:0
ENV HOME=/home/node PROJECTS_ROOT=/projects
VOLUME ["/app/data", "/home/node/.claude", "/projects"]
STOPSIGNAL SIGTERM
CMD ["node", "--env-file-if-exists=.env", "dist/index.js"]
