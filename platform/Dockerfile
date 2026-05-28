# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY platform/package.json platform/package.json
RUN corepack pnpm@9.12.0 install --filter @puddle/platform... --frozen-lockfile

FROM deps AS build
COPY platform platform
RUN corepack pnpm@9.12.0 --filter @puddle/platform build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app/platform

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/platform/node_modules /app/platform/node_modules
COPY --from=build /app/platform/package.json ./package.json
COPY --from=build /app/platform/.next ./.next
COPY --from=build /app/platform/public ./public

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const http=require('node:http');const req=http.get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',res=>process.exit(res.statusCode<500?0:1));req.on('error',()=>process.exit(1));req.setTimeout(4000,()=>{req.destroy();process.exit(1);});"

CMD ["npm", "run", "start"]
