import { Router } from 'express';
import { RoomController } from '../controllers/room.controller.js';
import { demoUploadGuard, uploadVideoMiddleware } from '../middleware/upload.middleware.js';
import { createRoomLimiter, deleteRoomLimiter, joinRoomLimiter, uploadVideoLimiter } from '../middleware/rate-limit.middleware.js';

const router = Router();

router.post('/', createRoomLimiter, RoomController.create);
router.get('/:roomId', RoomController.getById);
router.post('/:roomId/join', joinRoomLimiter, RoomController.join);
router.patch('/:roomId/settings', RoomController.updateSettings);
router.delete('/:roomId', deleteRoomLimiter, RoomController.delete);
// Demo: `demoUploadGuard` va ANTES de multer para no escribir el archivo.
// `video-url` (Drive) y el proxy quedan intactos: la demo reproduce por enlace.
router.post('/:roomId/video', uploadVideoLimiter, demoUploadGuard, uploadVideoMiddleware.single('video'), RoomController.uploadVideo);
router.post('/:roomId/video-url', uploadVideoLimiter, RoomController.setVideoUrl);
router.get('/:roomId/video/stream', RoomController.streamVideo);

export default router;
