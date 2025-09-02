# Install Required Dependencies for WebSocket Support

## Backend Dependencies

To enable WebSocket server functionality, run these commands in the backend directory:

```bash
cd packages/backend

# Install socket.io for WebSocket server
npm install socket.io

# Install types for development
npm install --save-dev @types/socket.io
```

## Frontend Dependencies

To enable WebSocket client functionality, run these commands in the frontend directory:

```bash
cd packages/frontend

# Install socket.io-client for WebSocket client
npm install socket.io-client

# Install types for development
npm install --save-dev @types/socket.io-client
```

These dependencies are required for:
- Backend WebSocket service implementation (subtask 7.4)  
- Frontend WebSocket client and context (subtask 7.5)