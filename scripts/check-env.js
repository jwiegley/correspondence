#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Checking environment setup...\n');

const checks = {
  backend_env: {
    path: path.join(__dirname, '../packages/backend/.env'),
    template: path.join(__dirname, '../packages/backend/.env.example'),
    name: 'Backend .env'
  },
  frontend_env: {
    path: path.join(__dirname, '../packages/frontend/.env'),
    template: path.join(__dirname, '../packages/frontend/.env.example'),
    name: 'Frontend .env'
  }
};

let allGood = true;

Object.entries(checks).forEach(([key, check]) => {
  if (!fs.existsSync(check.path)) {
    console.log(`❌ ${check.name} file not found at: ${check.path}`);
    console.log(`   Run 'npm run setup:env' to create it from template\n`);
    allGood = false;
  } else {
    console.log(`✅ ${check.name} file found`);
  }
});

if (allGood) {
  console.log('\n✨ All environment files are set up!');
  console.log('📝 Make sure to configure your Google OAuth credentials in packages/backend/.env');
} else {
  console.log('\n⚠️  Some environment files are missing.');
  console.log('Run: npm run setup:env');
}

process.exit(0); // Always exit successfully to not block npm install