import { Router } from 'express';
import { RoomController } from '../controllers/room.controller.js';
import { uploadVideoMiddleware } from '../middleware/upload.middleware.js';

const router = Router();

router.post('/', RoomController.create);
router.get('/:roomId', RoomController.getById);
router.post('/:roomId/join', RoomController.join);
router.post('/:roomId/video', uploadVideoMiddleware.single('video'), RoomController.uploadVideo);
router.get('/:roomId/video/stream', RoomController.streamVideo);

export default router;
