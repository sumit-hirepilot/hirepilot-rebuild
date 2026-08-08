# Railway Deployment - Quick Start

**GitHub**: sumit-hirepilot  
**Email**: sumit.designwork@gmail.com

## Step 1: Push to GitHub

```bash
cd /Users/sumit/Documents/Codex/hirepilot/hirepilot-rebuild

# Add remote if not already added
git remote add origin https://github.com/sumit-hirepilot/hirepilot-rebuild.git

# Or update if already exists
git remote set-url origin https://github.com/sumit-hirepilot/hirepilot-rebuild.git

# Push to GitHub
# The trunk is `production`; origin/main is a frozen archive - never push it.
git branch -M production
git push -u origin production
```

## Step 2: Create Railway Project

1. Go to https://railway.app
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Authorize with your GitHub account (sumit-hirepilot)
5. Search for and select `hirepilot-rebuild`

## Step 3: Deploy Backend Service

Railway should auto-detect the Dockerfile. If not:

1. In Railway dashboard, click the **Backend** service
2. Go to **Settings** → **Build**
3. Set:
   - Root Directory: `.`
   - Dockerfile Path: `docker/Dockerfile.backend`
   - Build Command: (leave empty)

4. Go to **Variables** tab
5. Add these environment variables:

```
NODE_ENV=production
PORT=3000
JWT_SECRET=your-secure-random-secret-key-here
FRONTEND_URL=https://your-frontend-railway-url.up.railway.app
```

## Step 4: Deploy PostgreSQL Database

1. In Railway dashboard, click **"New"** → **"PostgreSQL"**
2. Wait for it to initialize
3. Copy the connection string from the PostgreSQL service
4. In Backend service, go to **Variables**
5. Add database variables (Railway should auto-populate these):

```
DB_USER=postgres
DB_PASSWORD=[auto-filled from Railway]
DB_HOST=[auto-filled - Railway service name]
DB_PORT=5432
DB_NAME=hirepilot
```

6. Click the PostgreSQL service
7. Go to **Data** tab
8. Click **"Connect"** and run this SQL to initialize:

```sql
-- Copy the entire content of backend/schema.sql and paste here
```

Or simply push the code - Railway will auto-run schema.sql from docker-entrypoint-initdb.d

## Step 5: Deploy Frontend Service

1. Click **"New Service"** → **"GitHub repo"**
2. Select the same `hirepilot-rebuild` repo
3. Set:
   - Root Directory: `frontend`
   - Build Command: `npm run build`
   - Start Command: `npm start`

4. Go to **Variables**:

```
NEXT_PUBLIC_API_URL=https://your-backend-railway-url.up.railway.app
NODE_ENV=production
```

5. Go to **Settings** → **Network**
6. Enable Public URL
7. Copy the public URL (this is your frontend domain)

## Step 6: Update Environment Variables

Go back to **Backend** service Variables and update:

```
FRONTEND_URL=https://your-frontend-url.up.railway.app  # Update with actual URL from Step 5
```

## Step 7: Test Deployment

1. Open your Frontend URL in browser
2. You should see the HirePilot landing page
3. Try signing up - this will test the connection to backend

### Test Backend API directly:
```bash
curl https://your-backend-url.up.railway.app/api/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2024-07-24T..."
}
```

## Step 8: Verify Job Aggregation

The backend will automatically aggregate jobs every 6 hours. To test immediately:

```bash
curl -X POST https://your-backend-url.up.railway.app/api/jobs/aggregate
```

Check the logs in Railway to verify it's working:
- Backend service → **Logs** tab
- Look for "Starting job aggregation"

## Common Issues

### Frontend shows "API Status: disconnected"
- Check NEXT_PUBLIC_API_URL is set correctly in Frontend variables
- Verify Backend service is running (check Logs)
- Ensure backend URL is accessible

### Database connection failed
- Verify DB_HOST, DB_USER, DB_PASSWORD in Backend variables
- Check PostgreSQL service is running
- Ensure schema.sql was executed

### Jobs not aggregating
- Check Backend logs for error messages
- Verify external APIs are accessible (RemoteOK, We Work Remotely, Remotive)
- Check network connectivity

## Next Steps

1. ✅ GitHub repo created and pushed
2. ✅ Backend deployed with PostgreSQL
3. ✅ Frontend deployed
4. ✅ Job aggregation running

### Coming Soon
- Dashboard with Kanban board
- Resume tailoring
- Referral finder
- Standing search agents
- Full test suite

## Monitoring

### View Real-time Logs
Click any service → **Logs** tab

### Monitor Performance
Click service → **Analytics** tab for:
- CPU usage
- Memory usage
- Build times
- Deploy history

## Scaling (if needed)

In Railway dashboard → Service Settings:
- **Compute** tab: Adjust CPU/RAM
- **Replicas**: Set minimum replicas for load balancing

---

**Note**: All future pushes to GitHub will automatically trigger deployments on Railway. No manual action needed!
