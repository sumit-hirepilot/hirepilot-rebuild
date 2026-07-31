# Build stage
#
# Debian slim rather than Alpine, on both stages. Two reasons, and the second is
# what broke production:
#
#  1. Puppeteer's Chromium does not run on musl, and Alpine's own chromium
#     package failed to install in the runtime stage - the image never built,
#     Railway had no healthy container, and the API went down.
#  2. The stages must match. node_modules built against musl and copied into a
#     glibc image is a working setup right up until a dependency has a native
#     binding, and then it fails at require time in production rather than here.
FROM node:18-slim AS builder

WORKDIR /build

# Copy backend package files
COPY backend/package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Runtime stage
FROM node:18-slim

WORKDIR /app

ENV NODE_ENV=production
# Only a default for local `docker run`; Railway overrides PORT at runtime.
ENV PORT=3000

# Copy installed node_modules from builder
COPY --from=builder /build/node_modules ./node_modules

# Copy backend source code
COPY backend/ ./

EXPOSE 3000

# The probe MUST read PORT from the environment, not hardcode 3000. Railway
# injects its own PORT and the app binds to it (process.env.PORT || 3000), so a
# probe pinned to 3000 gets connection-refused, the container is marked unhealthy
# after the retries, and Railway then has no healthy replica to route to - which
# surfaces as a 502 with x-railway-fallback: true even though the app booted fine.
#
# Also handles the error case explicitly: the previous version threw inside the
# response callback and had no 'error' listener, so a refused connection produced
# an unhandled exception rather than a clean non-zero exit.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;require('http').get('http://127.0.0.1:'+p+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "index.js"]
