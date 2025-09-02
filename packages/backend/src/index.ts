import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import session from 'express-session';
import connectRedis from 'connect-redis';
import { createServer } from 'http';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { redisService } from './services/redis';
import { webSocketService } from './services/websocket';
import { syncService } from './services/sync';
import './config/passport'; // Import passport configuration
import passport from 'passport';
import authRoutes from './routes/auth';
import apiRoutes from './routes/api';

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

// Initialize Redis connection
redisService.connect().catch((err) => {
  logger.error('Redis service connection error:', err);
  process.exit(1);
});

// Initialize WebSocket service
webSocketService.initialize(httpServer);

const RedisStore = connectRedis(session);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(
  session({
    store: new RedisStore({ client: redisService.getClient() as any }),
    secret: process.env.SESSION_SECRET || 'development-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'sessionId', // Custom session name
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // For OAuth redirects
    },
  })
);

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// Health check
app.get('/health', async (req, res) => {
  const redisHealthy = await redisService.healthCheck();
  const redisStats = await redisService.getStats();
  const webSocketHealth = webSocketService.healthCheck();
  
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    services: {
      redis: {
        healthy: redisHealthy,
        connected: redisService.isHealthy(),
        stats: redisStats
      },
      websocket: {
        healthy: webSocketHealth.healthy,
        metrics: webSocketHealth.metrics,
        connectedUsers: webSocketHealth.connectedUsers
      }
    }
  });
});

// Error handling
app.use(errorHandler);

// Set up sync service event handlers for WebSocket integration
syncService.on('sync:started', (event) => {
  webSocketService.sendSyncStatus(event.userId, {
    state: 'syncing',
    lastSync: undefined,
    nextSync: undefined,
  });
});

syncService.on('sync:completed', (event) => {
  const { data } = event;
  webSocketService.sendSyncStatus(event.userId, {
    state: 'idle',
    lastSync: new Date(),
    nextSync: undefined,
  });
  
  webSocketService.broadcastSyncEvent(event.userId, 'sync:completed', data);
});

syncService.on('sync:failed', (event) => {
  const { data } = event;
  webSocketService.sendSyncStatus(event.userId, {
    state: 'error',
    lastSync: undefined,
    nextSync: undefined,
    error: data.error,
  });
  
  webSocketService.broadcastSyncEvent(event.userId, 'sync:failed', data);
});

syncService.on('messages:changed', (event) => {
  const { data } = event;
  webSocketService.broadcastMessageChanges(event.userId, data);
});

// Graceful shutdown handling
const shutdown = async () => {
  logger.info('Shutting down server gracefully...');
  
  try {
    await webSocketService.shutdown();
    await syncService.shutdown();
    await redisService.disconnect();
    
    httpServer.close(() => {
      logger.info('Server shutdown complete');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info('WebSocket server ready for connections');
});

export default app;