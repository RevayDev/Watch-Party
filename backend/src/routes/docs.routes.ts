import { Router, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from '../docs/openapi.js';

const router = Router();

// JSON crudo (para importar en Postman/Insomnia): GET /api/docs/json
router.get('/json', (_req: Request, res: Response) => {
  res.json(openapiSpec);
});

// UI interactiva: GET /api/docs (probar endpoints desde el navegador)
router.use('/', swaggerUi.serve, swaggerUi.setup(openapiSpec, { customSiteTitle: 'Watch Party API' }));

export default router;
