# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Correspondence is a Gmail client for processing emails with "Notify" and "Action-Item" labels. It's a monorepo with TypeScript-based backend (Express) and frontend (React + Vite), using Redis for session management and Google OAuth for authentication.

## Architecture

### Monorepo Structure
- **packages/backend**: Express server with TypeScript, handles OAuth, Gmail API, and WebSocket connections
- **packages/frontend**: React SPA with Vite, TanStack Query for data fetching, Socket.io for real-time updates  
- **packages/shared**: Shared TypeScript types between frontend and backend

### Key Services
- **Authentication**: Google OAuth 2.0 via Passport.js (packages/backend/src/config/passport.ts)
- **Session Management**: Redis-backed sessions using connect-redis
- **Email Sync**: Gmail API integration (packages/backend/src/services/gmail.ts, sync.ts)
- **Real-time Updates**: WebSocket service using Socket.io (packages/backend/src/services/websocket.ts)
- **Rate Limiting**: Redis-backed rate limiting with multiple tiers (packages/backend/src/middleware/rateLimiting.ts)

### Security Features
- Enhanced security middleware (packages/backend/src/middleware/security.ts)
- Token refresh mechanism (packages/backend/src/middleware/tokenRefresh.ts)
- Error monitoring with breadcrumbs (packages/backend/src/middleware/errorMonitoring.ts)

## Development Commands

```bash
# Initial setup (one-time)
npm install                    # Install all dependencies
npm run setup:env              # Create .env files

# Daily development
npm run docker:up              # Start Redis + Backend + Frontend
npm run docker:down           # Stop all services
npm run docker:restart        # Restart all services
npm run docker:logs          # View Docker logs

# Individual services
npm run dev:backend          # Start backend only (port 3000)
npm run dev:frontend         # Start frontend only (port 5173)

# Build commands
npm run build                # Build all packages
npm run build:backend        # Build backend only
npm run build:frontend       # Build frontend only

# Testing & Quality
npm run test                 # Run tests in all packages
npm run lint                 # Run ESLint in all packages
npm run format              # Format code with Prettier

# TypeScript checking
cd packages/backend && npx tsc --noEmit   # Check backend types
cd packages/frontend && npx tsc --noEmit  # Check frontend types
```

## Environment Configuration

Backend requires Google OAuth credentials in `packages/backend/.env`:
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- SESSION_SECRET (auto-generated)
- REDIS_URL (defaults to redis://localhost:6379)

## Development Workflow

1. **Always start Redis first**: Use `npm run docker:up` to ensure Redis is running
2. **TypeScript is relaxed**: `strict: false` in backend to allow incremental improvements
3. **Shared types**: Import from `@shared/*` in both frontend and backend
4. **WebSocket events**: Define in packages/shared for consistency

## Testing Approach

- Backend: Jest with ts-jest configuration
- Frontend: Vitest with React Testing Library
- Run specific test: `cd packages/[backend|frontend] && npm test -- [test-name]`

## Common Patterns

- **API Routes**: All under `/api/*` in backend/src/routes/api.ts
- **Auth Routes**: OAuth flow in backend/src/routes/auth.ts  
- **Error Handling**: Centralized in backend/src/middleware/errorMonitoring.ts
- **Frontend State**: TanStack Query for server state, Context API for auth state

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md
