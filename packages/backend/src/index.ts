import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import session from 'express-session';
import connectRedis from 'connect-redis';
import { createServer } from 'http';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { errorHandler as enhancedErrorHandler, breadcrumbMiddleware } from './middleware/errorMonitoring';
import { securityMiddleware } from './middleware/security';
import { rateLimiters, getRateLimitMetrics } from './middleware/rateLimiting';
import { getCSRFToken, CSRFConfig } from './middleware/csrf';
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

// Trust proxy for accurate IP addresses in rate limiting
app.set('trust proxy', 1);

// Security middleware stack (replaces helmet with enhanced security)
app.use(securityMiddleware);

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Cookie parser for CSRF tokens
app.use(cookieParser());

// Body parsing middleware with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration with enhanced security
app.use(
  session({
    store: new RedisStore({ client: redisService.getClient() as any }),
    secret: process.env.SESSION_SECRET || 'development-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'sessionId', // Custom session name
    rolling: true, // Reset expiration on activity
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 30 * 60 * 1000, // Reduced to 30 minutes for security
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // For OAuth redirects
    },
  })
);

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Error monitoring breadcrumbs
app.use(breadcrumbMiddleware);

// CSRF protection middleware (use double submit cookie for stateless approach)
app.use(CSRFConfig.doubleSubmit);

// CSRF token endpoint
app.get('/api/csrf-token', getCSRFToken);

// Routes with rate limiting
app.use('/auth', rateLimiters.auth, authRoutes);
app.use('/api', rateLimiters.api, apiRoutes);

// Health check with rate limiting metrics
app.get('/health', rateLimiters.public, async (req, res) => {
  const redisHealthy = await redisService.healthCheck();
  const redisStats = await redisService.getStats();
  const webSocketHealth = webSocketService.healthCheck();
  const rateLimitMetrics = await getRateLimitMetrics();
  
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
      },
      security: {
        rateLimiting: rateLimitMetrics
      }
    }
  });
});

// Error handling (use enhanced error handler for monitoring)
app.use(enhancedErrorHandler);

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