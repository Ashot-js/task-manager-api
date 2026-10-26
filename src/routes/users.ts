import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { HttpError, notFound } from '../errors';
import { authenticate, requireRole } from '../middleware/auth';
import { pageParams, paginated } from '../pagination';

// Admin-only user management.
const router = Router();
router.use(authenticate, requireRole('admin'));

const idSchema = z.object({ id: z.coerce.number().int().positive() });

// GET /users
router.get('/', async (req, res) => {
  const { page, limit } = z.object(pageParams).parse(req.query);
  const [rows, count] = await Promise.all([
    query(
      `SELECT u.id, u.email, u.name, u.role, u.created_at, count(t.id)::int AS task_count
       FROM users u LEFT JOIN tasks t ON t.owner_id = u.id
       GROUP BY u.id ORDER BY u.id LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit],
    ),
    query<{ total: number }>('SELECT count(*)::int AS total FROM users'),
  ]);
  res.json(paginated(rows.rows, count.rows[0]!.total, page, limit));
});

// PATCH /users/:id/role
router.patch('/:id/role', async (req, res) => {
  const { id } = idSchema.parse(req.params);
  const { role } = z.object({ role: z.enum(['user', 'admin']) }).parse(req.body);
  if (id === req.user!.id) throw new HttpError(400, 'self_change', 'You cannot change your own role');
  const { rows } = await query('UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, name, role', [role, id]);
  if (!rows[0]) throw notFound('User');
  res.json(rows[0]);
});

// DELETE /users/:id: also deletes the user's tasks
router.delete('/:id', async (req, res) => {
  const { id } = idSchema.parse(req.params);
  if (id === req.user!.id) throw new HttpError(400, 'self_delete', 'You cannot delete yourself');
  const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id]);
  if (!rowCount) throw notFound('User');
  res.status(204).end();
});

export default router;
