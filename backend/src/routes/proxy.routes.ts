import { Router, Request, Response } from 'express';
import { PROXY_MAX_REDIRECTS, proxyFetch } from '../services/proxy.service.js';
import { proxyLimiter } from '../middleware/rate-limit.middleware.js';

const router = Router();

// GET /api/proxy?url=<http(s) URL> (montado en app.ts bajo /api/proxy)
router.get('/', proxyLimiter, (req: Request, res: Response) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl || typeof targetUrl !== 'string') {
    res.status(400).json({ error: 'url query parameter is required' });
    return;
  }

  try {
    const parsed = new URL(targetUrl); // validate URL
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: 'Only http(s) URLs are allowed' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  proxyFetch(targetUrl, req, res, PROXY_MAX_REDIRECTS);
});

export default router;
