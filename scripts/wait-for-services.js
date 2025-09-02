#!/usr/bin/env node

const net = require('net');

console.log('⏳ Waiting for services to be ready...\n');

// Services to check
const services = [
  { name: 'Redis', host: 'localhost', port: 6379 }
];

// Check if a port is open
const checkPort = (host, port, timeout = 1000) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    
    const onError = () => {
      socket.destroy();
      resolve(false);
    };

    socket.setTimeout(timeout);
    socket.once('error', onError);
    socket.once('timeout', onError);

    socket.connect(port, host, () => {
      socket.end();
      resolve(true);
    });
  });
};

// Wait for a service with retries
const waitForService = async (service, maxRetries = 30, retryDelay = 1000) => {
  console.log(`Checking ${service.name} on ${service.host}:${service.port}...`);
  
  for (let i = 0; i < maxRetries; i++) {
    const isOpen = await checkPort(service.host, service.port);
    
    if (isOpen) {
      console.log(`✅ ${service.name} is ready!`);
      return true;
    }
    
    if (i < maxRetries - 1) {
      process.stdout.write('.');
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  console.log(`\n❌ ${service.name} failed to start after ${maxRetries} attempts`);
  return false;
};

// Main function
const main = async () => {
  let allReady = true;
  
  for (const service of services) {
    const ready = await waitForService(service);
    if (!ready) {
      allReady = false;
    }
  }
  
  if (allReady) {
    console.log('\n✨ All services are ready!');
    console.log('🚀 Starting application...\n');
    process.exit(0);
  } else {
    console.log('\n❌ Some services failed to start.');
    console.log('Check Docker logs with: npm run docker:logs');
    process.exit(1);
  }
};

main().catch(err => {
  console.error('Error waiting for services:', err);
  process.exit(1);
});