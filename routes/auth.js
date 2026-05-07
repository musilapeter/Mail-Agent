import { Router } from 'express';
import { gmailService } from '../services/gmail.service.js';

const router = Router();

router.get('/google', (req, res) => {
  const url = gmailService.getAuthUrl();
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  try {
    const email = await gmailService.handleCallback(req.query.code);
    res.redirect(`/?connected=${encodeURIComponent(email)}`);
  } catch (err) {
    res.redirect(`/?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/logout', async (req, res) => {
  try {
    await gmailService.disconnect();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
