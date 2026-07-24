# HirePilot Deployment Guide

## Local Development with Docker

### Prerequisites
- Docker & Docker Compose installed
- Node.js 18+ (for local dev without Docker)

### Start Development Environment

```bash
docker-compose up --build
```

Services will be available at:
- Frontend: http://localhost:3001
- Backend: http://localhost:3000
- Database: localhost:5432 (postgres/postgres)

### Stop Development Environment

```bash
docker-compose down
```

## Railway Deployment

### Prerequisites
- Railway account (https://railway.app)
- GitHub repository connected to Railway
- Git installed

### Step 1: Push to GitHub

```bash
git remote add origin https://github.com/sumit-hirepilot/hirepilot-rebuild.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy Backend to Railway

1. Go to https://railway.app
2. Click "New Project" → "Deploy from GitHub repo"
3. Select `sumit-hirepilot/hirepilot-rebuild`
4. Railway will auto-detect the Dockerfile at `docker/Dockerfile.backend`
5. In the Railway dashboard:
   - Click on the backend service
   - Go to Variables section
   - Add environment variables:

```
NODE_ENV=production
PORT=3000
DB_USER=postgres
DB_PASSWORD=[secure-password]
DB_HOST=[postgres-database-host]
DB_PORT=5432
DB_NAME=hirepilot
JWT_SECRET=[generate-random-secret]
FRONTEND_URL=https://[your-frontend-url]
```

### Step 3: Deploy PostgreSQL Database

1. In Railway dashboard, click "New" → "PostgreSQL"
2. Railway will automatically create a PostgreSQL instance
3. Copy the connection details and use them for DB_HOST, DB_USER, DB_PASSWORD
4. Railway will automatically initialize the database with `schema.sql`

### Step 4: Deploy Frontend to Railway

1. In Railway dashboard, click "New Service" → "GitHub repo"
2. Select the same repository
3. In the service settings:
   - Set Environment: `Production`
   - Override start command: `npm --prefix frontend run start`
   - Add environment variables:

```
NEXT_PUBLIC_API_URL=https://[your-backend-url]
NODE_ENV=production
```

### Step 5: Generate Initial Data

Run the job aggregation on Railway:
```bash
curl https://[your-backend-url]/api/jobs/aggregate -X POST
```

Or wait for the scheduled job (runs every 6 hours).

## Environment Variables Reference

### Backend
```env
NODE_ENV=production
PORT=3000
DB_USER=postgres
DB_PASSWORD=your-secure-password
DB_HOST=your-railway-db-host
DB_PORT=5432
DB_NAME=hirepilot
JWT_SECRET=your-random-secret-key
JWT_EXPIRY=7d
FRONTEND_URL=https://your-frontend-url
```

### Frontend
```env
NEXT_PUBLIC_API_URL=https://your-backend-url
```

## Monitoring

### View Logs
```bash
# Backend logs
railway logs --service backend

# Database logs
railway logs --service postgres
```

### Health Checks
- Backend health: `GET /api/health`
- Database connection verified in logs

## Troubleshooting

### Database Connection Failed
- Ensure DB_HOST, DB_USER, DB_PASSWORD are correct
- Check Railway PostgreSQL instance is running
- Verify database name is `hirepilot`

### Jobs Not Aggregating
- Check backend logs for job aggregation errors
- Verify external APIs (RemoteOK, We Work Remotely, Remotive) are accessible
- Manually trigger: `POST /api/jobs/aggregate`

### Frontend Not Loading
- Check NEXT_PUBLIC_API_URL environment variable
- Verify backend service is running and accessible
- Clear browser cache

## Scaling

### Database
Railway PostgreSQL automatically scales vertically. For horizontal scaling, consider:
- Read replicas (Railroad feature)
- Connection pooling via PgBouncer

### Backend/Frontend
- Set minimum replicas in Railway dashboard
- Configure CPU/memory limits based on usage

## Security

- Keep JWT_SECRET secure and unique
- Use strong database passwords
- Enable Railway's built-in DDoS protection
- Set up GitHub branch protection rules
- Use environment-specific secrets in Railway

## Rollback

To rollback a deployment:
1. Go to Railway dashboard
2. Select the service
3. Click "Rollback" on a previous deployment

## CI/CD with GitHub Actions

Railway automatically deploys when you push to your default branch. To control this:
1. Add `.railwayignore` to skip certain changes
2. Use GitHub status checks to prevent deploy on failed tests
3. Set up branch protection rules in GitHub
