# Multi-stage ARM64 image for ECS Fargate (C-4).
FROM --platform=linux/arm64 node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build:api

FROM --platform=linux/arm64 node:22-alpine AS runtime

# curl: health tooling + download Amazon RDS global CA bundle so Node/pg
# can verify Aurora TLS with rejectUnauthorized: true.
# Official CA URL: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html
RUN apk add --no-cache curl \
  && mkdir -p /certs \
  && curl -fsSL -o /certs/rds-global-bundle.pem \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  && test -s /certs/rds-global-bundle.pem \
  && chmod 644 /certs/rds-global-bundle.pem

WORKDIR /app

ENV NODE_ENV=production
ENV RDS_CA_BUNDLE_PATH=/certs/rds-global-bundle.pem

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
# SQL migrations for one-off ECS migrate tasks (not loaded by the API server).
COPY migrations ./migrations

RUN addgroup -S rbit && adduser -S rbit -G rbit \
  && chown -R rbit:rbit /app

USER rbit

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
