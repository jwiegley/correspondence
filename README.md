# Correspondence

Gmail correspondence viewer for processing emails with Notify and Action-Item labels.

## Features

- OAuth 2.0 authentication with Google
- Real-time email synchronization
- Visual categorization based on email labels
- Action buttons for managing email status
- Print-optimized layout

## Project Structure

```
correspondence/
├── packages/
│   ├── backend/      # Express + TypeScript backend
│   ├── frontend/     # React + TypeScript frontend
│   └── shared/       # Shared TypeScript types
├── docker-compose.yml
└── package.json      # Monorepo root
```

## Development

```bash
# Install dependencies
npm install

# Start development servers
npm run dev

# Run with Docker
npm run docker:up
```

## Environment Variables

Copy `.env.example` to `.env` and configure:
- Google OAuth credentials
- Redis connection settings
- Session secrets

## Requirements

- Node.js 18+
- Docker and Docker Compose
- Google Cloud project with Gmail API enabled