# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy backend package files
COPY ./backend/package*.json ./backend/

# Install production dependencies
WORKDIR /app/backend
RUN npm ci --only=production

# Runtime stage
FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy built node_modules
COPY --from=builder /app/backend/node_modules ./node_modules

# Copy backend source
COPY ./backend .

# Copy schema for database initialization if needed
COPY ./backend/schema.sql ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "index.js"]
