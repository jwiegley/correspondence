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

// Fetch emails from Gmail API
router.get('/emails', requireAuth, ensureValidTokens, async (req, res) => {
  try {
    const { gmailService } = await import('../services/gmail');
    const userId = req.user!.id;
    
    const result = await gmailService.fetchEmails(userId);
    
    res.json({
      emails: result.emails,
      nextPageToken: result.nextPageToken,
      totalCount: result.totalCount,
      tokenStatus: 'valid'
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    res.status(500).json({
      error: 'Failed to fetch emails',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Fetch Gmail labels
router.get('/labels', requireAuth, ensureValidTokens, async (req, res) => {
  try {
    const { gmailService } = await import('../services/gmail');
    const userId = req.user!.id;
    
    const labels = await gmailService.listLabels(userId);
    
    res.json({
      labels,
      tokenStatus: 'valid'
    });
  } catch (error) {
    console.error('Error fetching labels:', error);
    res.status(500).json({
      error: 'Failed to fetch labels',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Toggle email read status
router.patch('/emails/:emailId/read', requireAuth, ensureValidTokens, async (req, res) => {
  try {
    const { gmailService } = await import('../services/gmail');
    const userId = req.user!.id;
    const { emailId } = req.params;
    const { markAsRead } = req.body;

    // Validate request body
    if (typeof markAsRead !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid request body',
        message: 'markAsRead must be a boolean'
      });
    }

    // Validate email ID
    if (!emailId || typeof emailId !== 'string') {
      return res.status(400).json({
        error: 'Invalid email ID',
        message: 'Email ID must be a non-empty string'
      });
    }

    await gmailService.toggleReadStatus(userId, emailId, markAsRead);
    
    res.json({
      success: true,
      emailId,
      markAsRead,
      message: `Email ${markAsRead ? 'marked as read' : 'marked as unread'}`
    });
  } catch (error) {
    console.error(`Error ${req.body.markAsRead ? 'marking as read' : 'marking as unread'}:`, error);
    res.status(500).json({
      error: `Failed to ${req.body.markAsRead ? 'mark as read' : 'mark as unread'}`,
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add label to email
router.post('/emails/:emailId/labels', requireAuth, ensureValidTokens, async (req, res) => {
  try {
    const { gmailService } = await import('../services/gmail');
    const userId = req.user!.id;
    const { emailId } = req.params;
    const { labelName } = req.body;

    // Validate request body
    if (!labelName || typeof labelName !== 'string') {
      return res.status(400).json({
        error: 'Invalid request body',
        message: 'labelName must be a non-empty string'
      });
    }

    // Validate email ID
    if (!emailId || typeof emailId !== 'string') {
      return res.status(400).json({
        error: 'Invalid email ID',
        message: 'Email ID must be a non-empty string'
      });
    }

    await gmailService.toggleLabel(userId, emailId, labelName, true);
    
    res.json({
      success: true,
      emailId,
      labelName,
      action: 'added',
      message: `Label "${labelName}" added to email`
    });
  } catch (error) {
    console.error('Error adding label:', error);
    res.status(500).json({
      error: 'Failed to add label',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Remove label from email
router.delete('/emails/:emailId/labels/:labelName', requireAuth, ensureValidTokens, async (req, res) => {
  try {
    const { gmailService } = await import('../services/gmail');
    const userId = req.user!.id;
    const { emailId, labelName } = req.params;

    // Validate parameters
    if (!emailId || typeof emailId !== 'string') {
      return res.status(400).json({
        error: 'Invalid email ID',
        message: 'Email ID must be a non-empty string'
      });
    }

    if (!labelName || typeof labelName !== 'string') {
      return res.status(400).json({
        error: 'Invalid label name',
        message: 'Label name must be a non-empty string'
      });
    }

    await gmailService.toggleLabel(userId, emailId, decodeURIComponent(labelName), false);
    
    res.json({
      success: true,
      emailId,
      labelName: decodeURIComponent(labelName),
      action: 'removed',
      message: `Label "${decodeURIComponent(labelName)}" removed from email`
    });
  } catch (error) {
    console.error('Error removing label:', error);
    res.status(500).json({
      error: 'Failed to remove label',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Batch update emails (for future use)
router.patch('/emails/:emailId', requireAuth, ensureValidTokens, async (req, res) => {
  try {
    const { gmailService } = await import('../services/gmail');
    const userId = req.user!.id;
    const { emailId } = req.params;
    const update = req.body;

    // Validate email ID
    if (!emailId || typeof emailId !== 'string') {
      return res.status(400).json({
        error: 'Invalid email ID',
        message: 'Email ID must be a non-empty string'
      });
    }

    await gmailService.updateEmail(userId, emailId, update);
    
    res.json({
      success: true,
      emailId,
      update,
      message: 'Email updated successfully'
    });
  } catch (error) {
    console.error('Error updating email:', error);
    res.status(500).json({
      error: 'Failed to update email',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
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