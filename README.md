# HirePilot Rebuild

A full-stack AI-powered job search automation platform. GitHub + Railway only, no Higgsfield dependency.

**Status:** 4/13 tasks complete • Backend structure ready • Frontend starting

## Project Structure

```
hirepilot-rebuild/
├── backend/
│   ├── index.js                    # Express server with route handlers
│   ├── db.js                       # PostgreSQL connection pool
│   ├── schema.sql                  # Database schema (10+ tables)
│   ├── package.json                # Dependencies: pg, bcrypt, jwt, axios, cron
│   ├── middleware/
│   │   └── auth.js                 # JWT verification middleware
│   ├── routes/
│   │   └── auth.js                 # Signup, login, user management
│   └── services/
│       ├── jobAggregator.js        # Job aggregation orchestrator
│       ├── scheduler.js            # Cron-based scheduling (6-hour intervals)
│       └── apis/
│           ├── remoteok.js         # RemoteOK API client
│           ├── weworkremotely.js   # We Work Remotely API client
│           └── remotive.js         # Remotive API client
├── frontend/
│   ├── pages/
│   │   └── index.js                # Next.js home page (placeholder)
│   ├── public/                     # Static assets
│   ├── styles/                     # CSS modules
│   ├── package.json                # Dependencies: react, next, axios
│   └── next.config.js              # Next.js config
├── docker/
│   ├── Dockerfile.backend          # Node Alpine image
│   └── Dockerfile.frontend         # Next.js multi-stage build
├── docker-compose.yml              # Local dev orchestration
├── .claude/
│   └── launch.json                 # Preview server configuration
└── README.md
```

## Build Progress

### ✅ Completed
- Database schema with 10+ tables (users, jobs, matches, applications, agents)
- JWT authentication with bcrypt password hashing
- Job aggregation service for 3 sources (RemoteOK, We Work Remotely, Remotive)
- Scheduled aggregation (every 6 hours via node-cron)
- **Staleness bug fixed:** posted_at timestamp is preserved and never reset on re-fetch
- Express server with health check and placeholder endpoints

### ⏳ In Progress
- Matching engine (job-user scoring)
- API endpoints for jobs, matches, applications

### 📋 Planned
- Frontend: Landing page, dashboard, Kanban board
- Resume tailoring
- Referral finder
- Standing search agents
- Dockerization
- Railway deployment
- Full test suite

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Docker & Docker Compose (optional)

### Development Setup

#### Without Docker

1. **Backend Setup**
   ```bash
   cd backend
   npm install
   cp .env.example .env
   npm run dev
   ```
   Backend runs on `http://localhost:3000`

2. **Frontend Setup** (in a new terminal)
   ```bash
   cd frontend
   npm install
   cp .env.example .env.local
   npm run dev
   ```
   Frontend runs on `http://localhost:3000`

#### With Docker

```bash
docker-compose up --build
```

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:3001`

## Environment Variables

### Backend
Create `backend/.env` from `backend/.env.example`:
```
NODE_ENV=development
PORT=3000
```

### Frontend
Create `frontend/.env.local` from `frontend/.env.example`:
```
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## Scripts

### Backend
- `npm run dev` - Start development server with nodemon
- `npm start` - Start production server
- `npm test` - Run tests

### Frontend
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

## API Endpoints

- `GET /` - Welcome message
- `GET /api/health` - Health check

## Deployment

### Railway
This project is designed to be deployed on Railway:

1. Connect this repository to Railway
2. Set up environment variables in Railway dashboard
3. Deploy backend and frontend as separate services

## Contributing

1. Create a feature branch
2. Commit your changes
3. Push to the branch
4. Open a pull request

## License

ISC
