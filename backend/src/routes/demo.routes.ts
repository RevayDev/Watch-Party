import { Router } from 'express';
import { DemoController } from '../controllers/demo.controller.js';

const router = Router();

// Solo conteos (roomsUsed/roomsTotal/roomsAvailable). El rate-limit se aplica
// al montar (`app.use('/api/demo', globalLimiter, ...)` en app.ts).
router.get('/availability', DemoController.availability);

export default router;
