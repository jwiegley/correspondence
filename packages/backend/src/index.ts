import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import session from 'express-session';
import connectRedis from 'connect-redis';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { redisService } from './services/redis';
import './config/passport'; // Import passport configuration
import passport from 'passport';
import authRoutes from './routes/auth';
import apiRoutes from './routes/api';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Redis connection
redisService.connect().catch((err) => {
  logger.error('Redis service connection error:', err);
  process.exit(1);
});

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
  
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    services: {
      redis: {
        healthy: redisHealthy,
        connected: redisService.isHealthy(),
        stats: redisStats
      }
    }
  });
});

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

export default app;