import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { pool } from './db';
import { errorHandler, notFound } from './errors';
import { openapi } from './openapi';
import authRoutes from './routes/auth';
import taskRoutes from './routes/tasks';
import userRoutes from './routes/users';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render's proxy: req.ip is the client

  // Swagger UI needs inline scripts/styles; the API itself serves only JSON.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '20kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120 }));

  app.get('/', (_req, res) => res.redirect('/docs'));
  app.get('/openapi.json', (_req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Task Manager API' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  });

  app.use('/auth', authRoutes);
  app.use('/tasks', taskRoutes);
  app.use('/users', userRoutes);

  app.use(() => {
    throw notFound('Route');
  });
  app.use(errorHandler);
  return app;
}
