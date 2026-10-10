import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller.js';
import { requireAdmin } from '../middleware/admin.middleware.js';

const router = Router();

// Todo el panel exige ADMIN_TOKEN (401 sin token, 503 sin configurar).
router.use(requireAdmin);

router.get('/rooms', AdminController.listRooms);
router.get('/rooms/:roomId', AdminController.getRoom);
router.patch('/rooms/:roomId/settings', AdminController.updateSettings);
router.delete('/rooms/:roomId', AdminController.deleteRoom);
router.post('/rooms/:roomId/kick', AdminController.kick);
router.post('/rooms/:roomId/unban', AdminController.unban);
router.post('/rooms/:roomId/role', AdminController.setRole);
router.post('/rooms/:roomId/transfer-leader', AdminController.transferLeader);
router.post('/rooms/:roomId/rename', AdminController.rename);
router.post('/rooms/:roomId/mute', AdminController.mute);

export default router;
