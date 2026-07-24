# Build stage
FROM node:18-alpine AS builder

WORKDIR /build

# Copy backend package files
COPY backend/package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Runtime stage
FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy installed node_modules from builder
COPY --from=builder /build/node_modules ./node_modules

# Copy backend source code
COPY backend/ ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "index.js"]
