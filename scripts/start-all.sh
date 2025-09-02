#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Gmail Correspondence Manager${NC}\n"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
fi

# Check environment files
echo -e "${GREEN}🔍 Checking environment setup...${NC}"
node scripts/check-env.js

# Create .env files if they don't exist
if [ ! -f "packages/backend/.env" ] || [ ! -f "packages/frontend/.env" ]; then
    echo -e "${YELLOW}📝 Creating environment files...${NC}"
    node scripts/setup-env.js
fi

# Check if Google OAuth credentials are configured
if [ -f "packages/backend/.env" ]; then
    if ! grep -q "GOOGLE_CLIENT_ID=your_client_id_here" packages/backend/.env; then
        echo -e "${GREEN}✅ Google OAuth credentials appear to be configured${NC}"
    else
        echo -e "${YELLOW}⚠️  WARNING: Google OAuth credentials not configured!${NC}"
        echo -e "${YELLOW}   Please add your credentials to packages/backend/.env${NC}"
        echo -e "${YELLOW}   See START_HERE.md for instructions${NC}\n"
    fi
fi

# Start Docker services
echo -e "${GREEN}🐳 Starting Docker services...${NC}"
docker-compose up -d

# Wait for services
echo -e "${GREEN}⏳ Waiting for services to be ready...${NC}"
node scripts/wait-for-services.js

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✨ All services ready!${NC}\n"
    
    # Start the application
    echo -e "${GREEN}🎯 Starting application servers...${NC}"
    echo -e "${GREEN}   Frontend: http://localhost:5173${NC}"
    echo -e "${GREEN}   Backend:  http://localhost:3000${NC}\n"
    
    npm run dev
else
    echo -e "${RED}❌ Failed to start services${NC}"
    echo -e "Run 'npm run docker:logs' to check for errors"
    exit 1
fi