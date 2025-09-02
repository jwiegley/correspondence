#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('🔧 Setting up environment files...\n');

// Generate a secure session secret
const generateSecret = () => crypto.randomBytes(32).toString('hex');

const envFiles = [
  {
    template: path.join(__dirname, '../packages/backend/.env.example'),
    target: path.join(__dirname, '../packages/backend/.env'),
    name: 'Backend',
    defaults: {
      SESSION_SECRET: generateSecret(),
      PORT: '3000',
      REDIS_URL: 'redis://localhost:6379',
      NODE_ENV: 'development',
      FRONTEND_URL: 'http://localhost:5173'
    }
  },
  {
    template: path.join(__dirname, '../packages/frontend/.env.example'),
    target: path.join(__dirname, '../packages/frontend/.env'),
    name: 'Frontend',
    defaults: {
      VITE_API_URL: 'http://localhost:3000',
      VITE_WS_URL: 'ws://localhost:3000'
    }
  }
];

envFiles.forEach(({ template, target, name, defaults }) => {
  if (fs.existsSync(target)) {
    console.log(`✅ ${name} .env already exists - skipping`);
    return;
  }

  let content = '';
  
  if (fs.existsSync(template)) {
    // Copy from template
    content = fs.readFileSync(template, 'utf8');
  } else {
    // Create with defaults if no template exists
    console.log(`⚠️  No template found for ${name}, creating with defaults...`);
    content = Object.entries(defaults)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  }

  // Replace placeholder values with defaults
  Object.entries(defaults).forEach(([key, value]) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      // Update existing key
      content = content.replace(regex, `${key}=${value}`);
    } else {
      // Add missing key
      content += `\n${key}=${value}`;
    }
  });

  fs.writeFileSync(target, content);
  console.log(`✅ Created ${name} .env file at: ${target}`);
});

console.log('\n📝 Environment files created!');
console.log('\n⚠️  IMPORTANT: You need to add your Google OAuth credentials:');
console.log('   1. Go to https://console.cloud.google.com/');
console.log('   2. Create/select a project and enable Gmail API');
console.log('   3. Create OAuth 2.0 credentials');
console.log('   4. Add http://localhost:3000/auth/google/callback as redirect URI');
console.log('   5. Copy Client ID and Secret to packages/backend/.env');
console.log('\n   GOOGLE_CLIENT_ID=your_client_id_here');
console.log('   GOOGLE_CLIENT_SECRET=your_client_secret_here\n');