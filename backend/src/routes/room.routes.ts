import { Router } from 'express';
import { RoomController } from '../controllers/room.controller.js';
import { uploadVideoMiddleware } from '../middleware/upload.middleware.js';
import { createRoomLimiter, uploadVideoLimiter } from '../middleware/rate-limit.middleware.js';

const router = Router();

router.post('/', createRoomLimiter, RoomController.create);
router.get('/:roomId', RoomController.getById);
router.post('/:roomId/join', RoomController.join);
router.patch('/:roomId/settings', RoomController.updateSettings);
router.delete('/:roomId', RoomController.delete);
router.post('/:roomId/video', uploadVideoLimiter, uploadVideoMiddleware.single('video'), RoomController.uploadVideo);
router.post('/:roomId/video-url', uploadVideoLimiter, RoomController.setVideoUrl);
router.get('/:roomId/video/stream', RoomController.streamVideo);

export default router;
