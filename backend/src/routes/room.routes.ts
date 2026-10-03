import { Router } from 'express';
import { RoomController } from '../controllers/room.controller.js';
import { uploadVideoMiddleware } from '../middleware/upload.middleware.js';

const router = Router();

router.post('/', RoomController.create);
router.get('/:roomId', RoomController.getById);
router.post('/:roomId/join', RoomController.join);
router.patch('/:roomId/settings', RoomController.updateSettings);
router.delete('/:roomId', RoomController.delete);
router.post('/:roomId/video', uploadVideoMiddleware.single('video'), RoomController.uploadVideo);
router.post('/:roomId/video-url', RoomController.setVideoUrl);
router.get('/:roomId/video/stream', RoomController.streamVideo);

export default router;
