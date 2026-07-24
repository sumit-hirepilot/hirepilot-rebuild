# HirePilot Rebuild

A full-stack recruitment and hiring platform built with Node.js/Express backend and React/Next.js frontend.

## Project Structure

```
hirepilot-rebuild/
├── backend/              # Express.js API server
│   ├── index.js         # Main server file
│   ├── package.json     # Backend dependencies
│   └── .env.example     # Environment variables template
├── frontend/             # Next.js React application
│   ├── pages/           # Next.js pages
│   ├── public/          # Static assets
│   ├── styles/          # CSS/styling
│   ├── package.json     # Frontend dependencies
│   ├── next.config.js   # Next.js configuration
│   └── .env.example     # Environment variables template
├── docker/               # Docker configuration files
│   ├── Dockerfile.backend
│   └── Dockerfile.frontend
├── docker-compose.yml   # Docker Compose orchestration
├── .gitignore          # Git ignore rules
└── README.md           # This file
```

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
