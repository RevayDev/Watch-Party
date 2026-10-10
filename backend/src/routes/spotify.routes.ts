import { Router } from 'express';
import { SpotifyController } from '../controllers/spotify.controller.js';
import { spotifySearchLimiter } from '../middleware/rate-limit.middleware.js';

const router = Router();

router.get('/resolve', SpotifyController.resolve);
router.get('/status', SpotifyController.status);
router.get('/auth-url', SpotifyController.authUrl);
router.get('/callback', SpotifyController.callback);
router.post('/disconnect', SpotifyController.disconnect);
// Búsqueda con límite propio (30/min/IP) además del paraguas global.
router.get('/search', spotifySearchLimiter, SpotifyController.search);

export default router;
