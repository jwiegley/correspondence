import { Router, Request, Response } from 'express';
import { gmail_v1, google } from 'googleapis';
import { requireAuth } from '../middleware/auth';
import { logger } from '../utils/logger';
import { redisService } from '../services/redis';
import { decryptTokens } from '../utils/crypto';

const router = Router();

// Apply auth middleware to all routes
router.use(requireAuth);

// Initialize Gmail client
async function getGmailClient(userId: string): Promise<gmail_v1.Gmail> {
  try {
    // Get encrypted tokens from Redis
    const encryptedTokensStr = await redisService.getUserTokens(userId);
    if (!encryptedTokensStr) {
      throw new Error('No tokens found for user');
    }

    const encryptedTokens = JSON.parse(encryptedTokensStr);
    const tokens = decryptTokens(encryptedTokens);

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // Set credentials
    oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });

    // Return Gmail client
    return google.gmail({ version: 'v1', auth: oauth2Client });
  } catch (error) {
    logger.error('Failed to create Gmail client:', error);
    throw error;
  }
}

// GET /api/emails - Get filtered emails
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    
    // For now return the actual Gmail emails
    const gmail = await getGmailClient(user.id);
    
    // First, get all labels to map IDs to names
    const labelsResponse = await gmail.users.labels.list({
      userId: 'me',
    });
    const labelMap = new Map<string, string>();
    (labelsResponse.data.labels || []).forEach(label => {
      if (label.id && label.name) {
        labelMap.set(label.id, label.name);
      }
    });
    
    // Query for unread emails in inbox OR emails with specific labels
    // Note: Gmail labels need to be exact matches - check if labels exist
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox', // Get all inbox emails, we'll filter client-side
      maxResults: 500,
    });
    
    const messages = response.data.messages || [];
    
    if (messages.length === 0) {
      return res.json({ emails: [] });
    }
    
    // Get details for each message (process up to 100 for reasonable performance)
    const emailPromises = messages.slice(0, 100).map(async (message) => {
      try {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });
        
        const headers = msg.data.payload?.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        
        // Map label IDs to names
        const labelNames = (msg.data.labelIds || []).map(id => labelMap.get(id) || id);
        
        return {
          id: message.id,
          threadId: message.threadId,
          subject,
          from,
          date,
          snippet: msg.data.snippet || '',
          unread: msg.data.labelIds?.includes('UNREAD') || false,
          labels: labelNames, // Return label names instead of IDs
          labelIds: msg.data.labelIds || [], // Also return raw IDs for debugging
        };
      } catch (err) {
        logger.error(`Error fetching message ${message.id}:`, err);
        return null;
      }
    });
    
    const emails = (await Promise.all(emailPromises)).filter(e => e !== null);
    
    logger.info(`Successfully fetched ${emails.length} emails`);
    
    return res.json({ emails });
    
    // Mock data for testing the UI (keeping as comment for reference)
    /*const mockEmails = [
      {
        id: '1',
        threadId: 't1',
        subject: 'Weekly Meeting Agenda',
        from: 'John Doe <john@example.com>',
        date: new Date(Date.now() - 86400000).toISOString(),
        snippet: 'Please review the attached agenda for our weekly meeting tomorrow...',
        unread: true,
        labels: [],
      },
      {
        id: '2',
        threadId: 't2',
        subject: 'Action Required: Budget Approval',
        from: 'Jane Smith <jane@example.com>',
        date: new Date(Date.now() - 172800000).toISOString(),
        snippet: 'The Q4 budget proposal needs your approval by end of week...',
        unread: false,
        labels: ['Action-Item'],
      },
      {
        id: '3',
        threadId: 't3',
        subject: 'System Maintenance Notification',
        from: 'IT Department <it@example.com>',
        date: new Date(Date.now() - 259200000).toISOString(),
        snippet: 'Scheduled maintenance will occur this weekend from 2 AM to 6 AM...',
        unread: false,
        labels: ['Notify'],
      },
      {
        id: '4',
        threadId: 't4',
        subject: 'Project Update: Phase 2 Complete',
        from: 'Project Manager <pm@example.com>',
        date: new Date(Date.now() - 345600000).toISOString(),
        snippet: 'I am pleased to announce that Phase 2 of the project is now complete...',
        unread: true,
        labels: ['Notify'],
      },
      {
        id: '5',
        threadId: 't5',
        subject: 'Urgent: Client Meeting Tomorrow',
        from: 'Sales Team <sales@example.com>',
        date: new Date(Date.now() - 3600000).toISOString(),
        snippet: 'Reminder: Important client meeting scheduled for tomorrow at 10 AM...',
        unread: true,
        labels: ['Action-Item'],
      },
    ];

    logger.info(`Returning ${mockEmails.length} mock emails for testing`);

    res.json({
      emails: mockEmails,
    });*/
  } catch (error: any) {
    logger.error('Failed to fetch emails:', error);
    logger.error('Error details:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch emails: ' + error.message });
  }
});

// PUT /api/emails/:id/read - Toggle read/unread status
router.put('/:id/read', async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const emailId = req.params.id;
    const { unread } = req.body; // false = mark as read, true = mark as unread
    
    const gmail = await getGmailClient(user.id);
    
    // To mark as read: remove UNREAD label
    // To mark as unread: add UNREAD label
    if (unread === false) {
      // Mark as read - remove UNREAD label
      await gmail.users.messages.modify({
        userId: 'me',
        id: emailId,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        }
      });
      logger.info(`Marked email ${emailId} as read`);
    } else {
      // Mark as unread - add UNREAD label
      await gmail.users.messages.modify({
        userId: 'me',
        id: emailId,
        requestBody: {
          addLabelIds: ['UNREAD'],
        }
      });
      logger.info(`Marked email ${emailId} as unread`);
    }
    
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to update read status:', error);
    res.status(500).json({ error: 'Failed to update read status' });
  }
});

// Helper function to get or create a label
async function getOrCreateLabel(gmail: gmail_v1.Gmail, labelName: string): Promise<string | null> {
  try {
    logger.info(`Getting or creating label: ${labelName}`);
    
    // First, list all labels to see if it exists
    const labelsResponse = await gmail.users.labels.list({
      userId: 'me',
    });
    
    const labels = labelsResponse.data.labels || [];
    logger.info(`Found ${labels.length} existing labels`);
    
    const existingLabel = labels.find(l => l.name === labelName);
    
    if (existingLabel) {
      logger.info(`Found existing label: ${labelName} with ID: ${existingLabel.id}`);
      return existingLabel.id || null;
    }
    
    // Create the label if it doesn't exist
    logger.info(`Label '${labelName}' not found, creating new label`);
    const createResponse = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    
    logger.info(`Successfully created label: ${labelName} with ID: ${createResponse.data.id}`);
    return createResponse.data.id || null;
  } catch (error: any) {
    logger.error(`Failed to get/create label ${labelName}:`, error.message);
    if (error.response) {
      logger.error('Error response:', error.response.data);
    }
    return null;
  }
}

// POST /api/emails/:id/labels - Add label to email
router.post('/:id/labels', async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const { label } = req.body;
    const emailId = req.params.id;
    
    logger.info(`Request body:`, req.body);
    
    if (!label || typeof label !== 'string' || label.trim() === '') {
      logger.error('Invalid label provided:', label);
      return res.status(400).json({ error: 'Invalid request body', message: 'labelName must be a non-empty string' });
    }
    
    logger.info(`Adding label ${label} to email ${emailId} for user ${user.id}`);
    
    let gmail;
    try {
      gmail = await getGmailClient(user.id);
    } catch (error) {
      logger.error(`Failed to create Gmail client for user ${user.id}:`, error);
      return res.status(500).json({ error: 'Failed to connect to Gmail' });
    }
    
    // Get or create the label
    const labelId = await getOrCreateLabel(gmail, label);
    
    if (!labelId) {
      logger.error(`Failed to get/create label: ${label}`);
      throw new Error(`Failed to get/create label: ${label}`);
    }
    
    // Add the label to the email
    await gmail.users.messages.modify({
      userId: 'me',
      id: emailId,
      requestBody: {
        addLabelIds: [labelId],
      }
    });
    
    logger.info(`Successfully added label '${label}' (ID: ${labelId}) to email ${emailId}`);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to add label:', error);
    res.status(500).json({ error: 'Failed to add label' });
  }
});

// DELETE /api/emails/:id/labels - Remove label from email
router.delete('/:id/labels', async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const { label } = req.body;
    const emailId = req.params.id;
    
    if (!label || typeof label !== 'string' || label.trim() === '') {
      logger.error('Invalid label provided:', label);
      return res.status(400).json({ error: 'Invalid request body', message: 'labelName must be a non-empty string' });
    }
    
    logger.info(`Removing label ${label} from email ${emailId}`);
    
    const gmail = await getGmailClient(user.id);
    
    // Get the label ID
    const labelsResponse = await gmail.users.labels.list({
      userId: 'me',
    });
    
    const labels = labelsResponse.data.labels || [];
    const existingLabel = labels.find(l => l.name === label);
    
    if (!existingLabel || !existingLabel.id) {
      logger.warn(`Label '${label}' not found, cannot remove`);
      res.json({ success: true, note: 'Label not found' });
      return;
    }
    
    // Remove the label from the email
    await gmail.users.messages.modify({
      userId: 'me',
      id: emailId,
      requestBody: {
        removeLabelIds: [existingLabel.id],
      }
    });
    
    logger.info(`Successfully removed label '${label}' (ID: ${existingLabel.id}) from email ${emailId}`);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to remove label:', error);
    res.status(500).json({ error: 'Failed to remove label' });
  }
});

export default router;