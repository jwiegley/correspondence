# 🚀 Quick Start Guide

## One-Command Startup

From the project root directory, simply run:

```bash
npm run docker:up
```

This single command will:
1. ✅ Start Redis in Docker
2. ✅ Wait for Redis to be ready
3. ✅ Start the backend server (port 3000)
4. ✅ Start the frontend dev server (port 5173)

## First Time Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Google OAuth
The setup script will create `.env` files automatically, but you need to add your Google OAuth credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable **Gmail API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Set Application Type to **Web application**
6. Add Authorized redirect URI: `http://localhost:3000/auth/google/callback`
7. Copy the **Client ID** and **Client Secret**

### 3. Add Credentials to Backend
Edit `packages/backend/.env` and add:
```env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run docker:up` | **Start everything** (Redis + Backend + Frontend) |
| `npm run docker:down` | Stop all services |
| `npm run docker:restart` | Restart all services |
| `npm run docker:logs` | View Docker logs |
| `npm start` | Alias for `docker:up` |
| `npm stop` | Alias for `docker:down` |

## Access the Application

Once started, open your browser to:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **Redis**: localhost:6379

## Troubleshooting

### Port Already in Use
If you get port conflicts, you can check what's using the ports:
```bash
lsof -i :5173  # Frontend
lsof -i :3000  # Backend
lsof -i :6379  # Redis
```

### Redis Connection Issues
```bash
# Check if Redis is running
docker ps | grep redis

# View Redis logs
npm run docker:logs
```

### Environment Variables Not Set
```bash
# Check environment setup
npm run check:env

# Recreate .env files
npm run setup:env
```

## Stop Everything
```bash
npm run docker:down
# or
npm stop
```