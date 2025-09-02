import { Router } from 'express';
import { requireAuth, logAuthenticatedRequest } from '../middleware/auth';
import { ensureValidTokens, proactiveTokenRefresh, attachTokenInfo } from '../middleware/tokenRefresh';
import { tokenRefreshService } from '../services/tokenRefresh';

const router = Router();

// Apply middleware to all API routes
router.use(logAuthenticatedRequest);
router.use(attachTokenInfo);
router.use(proactiveTokenRefresh(15)); // Refresh tokens if expiring within 15 minutes

// Token status endpoint
router.get('/tokens/status', requireAuth, async (req, res) => {
  try {
    const tokenInfo = await tokenRefreshService.getTokenInfo(req.user!.id);
    res.json({
      ...tokenInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get token status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Token refresh endpoint (manual)
router.post('/tokens/refresh', requireAuth, async (req, res) => {
  try {
    const tokens = await tokenRefreshService.getValidTokens(req.user!.id);
    res.json({
      message: 'Tokens refreshed successfully',
      hasTokens: !!tokens,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(401).json({
      error: 'Token refresh failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Placeholder for email routes (with token validation)
router.get('/emails', requireAuth, ensureValidTokens, async (req, res) => {
  // TODO: Implement email fetching with Gmail API
  // At this point, req.tokens contains valid OAuth tokens
  const tokens = (req as any).tokens;
  
  res.json({ 
    emails: [],
    message: 'Email fetching not yet implemented',
    tokenStatus: 'valid'
  });
});

// Placeholder for label routes (with token validation)
router.get('/labels', requireAuth, ensureValidTokens, async (req, res) => {
  // TODO: Implement label fetching with Gmail API
  const tokens = (req as any).tokens;
  
  res.json({ 
    labels: [],
    message: 'Label fetching not yet implemented',
    tokenStatus: 'valid'
  });
});

// Placeholder for email action routes (with token validation)
router.patch('/emails/:id', requireAuth, ensureValidTokens, async (req, res) => {
  // TODO: Implement email updates with Gmail API
  const tokens = (req as any).tokens;
  const emailId = req.params.id;
  
  res.json({ 
    success: true,
    emailId,
    message: 'Email updates not yet implemented',
    tokenStatus: 'valid'
  });
});

// Test route for Gmail API integration
router.get('/gmail/profile', requireAuth, ensureValidTokens, async (req, res) => {
  try {
    const tokens = (req as any).tokens;
    
    // TODO: Use Gmail API to get user profile
    res.json({
      message: 'Gmail profile endpoint ready',
      userId: req.user!.id,
      tokenStatus: 'valid',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get Gmail profile',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;