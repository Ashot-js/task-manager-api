import { Router, type Request } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { query } from '../db';
import { HttpError, notFound } from '../errors';
import { authenticate } from '../middleware/auth';
import { pageParams, paginated } from '../pagination';

const router = Router();
router.use(authenticate);

const STATUSES = ['todo', 'in_progress', 'done'] as const;
const PRIORITIES = ['low', 'medium', 'high'] as const;
const date = z.iso.date();

const taskFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  due_date: date.nullable(),
};
const createSchema = z.object({
  ...taskFields,
  description: taskFields.description.default(''),
  status: taskFields.status.default('todo'),
  priority: taskFields.priority.default('medium'),
  due_date: taskFields.due_date.default(null),
});
const updateSchema = z
  .object(taskFields)
  .partial()
  .refine((t) => Object.keys(t).length > 0, 'Send at least one field to update');
type TaskInput = z.infer<typeof createSchema>;
const FIELDS = Object.keys(taskFields) as (keyof TaskInput)[];

// Whitelisted ORDER BY clauses; id breaks ties so pages never overlap.
const SORTS = {
  created_at: 'created_at',
  due_date: 'due_date',
  title: 'lower(title)',
  priority: "array_position(ARRAY['low','medium','high'], priority)",
} as const;

const listSchema = z.object({
  ...pageParams,
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  due_before: date.optional(),
  due_after: date.optional(),
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS]).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  /** Admins only: limit to one user's tasks. */
  owner_id: z.coerce.number().int().positive().optional(),
});

const idSchema = z.object({ id: z.coerce.number().int().positive() });

/** WHERE clause that limits a query to the tasks this user may see: own tasks, or all for admins. */
function visibility(req: Request, params: unknown[]): string {
  if (req.user!.role === 'admin') return 'TRUE';
  params.push(req.user!.id);
  return `owner_id = $${params.length}`;
}

// GET /tasks
router.get('/', async (req, res) => {
  const f = listSchema.parse(req.query);
  const params: unknown[] = [];
  const where = [visibility(req, params)];
  const add = (sql: (n: string) => string, value: unknown) => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };

  if (f.status) add((n) => `status = ${n}`, f.status);
  if (f.priority) add((n) => `priority = ${n}`, f.priority);
  if (f.q) add((n) => `(title ILIKE ${n} OR description ILIKE ${n})`, `%${f.q.replace(/[\\%_]/g, '\\$&')}%`);
  if (f.due_before) add((n) => `due_date <= ${n}`, f.due_before);
  if (f.due_after) add((n) => `due_date >= ${n}`, f.due_after);
  if (f.owner_id !== undefined) {
    if (req.user!.role !== 'admin') throw new HttpError(403, 'forbidden', 'Only admins can filter by owner');
    add((n) => `owner_id = ${n}`, f.owner_id);
  }

  const whereSql = where.join(' AND ');
  const order = `${SORTS[f.sort]} ${f.order.toUpperCase()} NULLS LAST, id ${f.order.toUpperCase()}`;
  const [rows, count] = await Promise.all([
    query(
      `SELECT * FROM tasks WHERE ${whereSql} ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.limit, (f.page - 1) * f.limit],
    ),
    query<{ total: number }>(`SELECT count(*)::int AS total FROM tasks WHERE ${whereSql}`, params),
  ]);
  res.json(paginated(rows.rows, count.rows[0]!.total, f.page, f.limit));
});

// POST /tasks
router.post('/', async (req, res) => {
  const task = createSchema.parse(req.body);
  const { rows: count } = await query<{ n: number }>('SELECT count(*)::int AS n FROM tasks WHERE owner_id = $1', [req.user!.id]);
  if (count[0]!.n >= config.maxTasksPerUser) {
    throw new HttpError(422, 'task_limit', `A user can have at most ${config.maxTasksPerUser} tasks`);
  }
  const { rows } = await query(
    `INSERT INTO tasks (owner_id, ${FIELDS.join(', ')})
     VALUES ($1, ${FIELDS.map((_, i) => `$${i + 2}`).join(', ')})
     RETURNING *`,
    [req.user!.id, ...FIELDS.map((f) => task[f])],
  );
  res.status(201).json(rows[0]);
});

// GET /tasks/:id
router.get('/:id', async (req, res) => {
  const { id } = idSchema.parse(req.params);
  const params: unknown[] = [id];
  const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND ${visibility(req, params)}`, params);
  if (!rows[0]) throw notFound('Task');
  res.json(rows[0]);
});

// PATCH /tasks/:id: only the fields that are sent change
router.patch('/:id', async (req, res) => {
  const { id } = idSchema.parse(req.params);
  const patch = updateSchema.parse(req.body);
  const fields = FIELDS.filter((f) => patch[f] !== undefined);
  // Column names come from the schema whitelist; values are parameters.
  const params: unknown[] = [...fields.map((f) => patch[f]), id];
  const set = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const { rows } = await query(
    `UPDATE tasks SET ${set}, updated_at = now() WHERE id = $${params.length} AND ${visibility(req, params)} RETURNING *`,
    params,
  );
  if (!rows[0]) throw notFound('Task');
  res.json(rows[0]);
});

// DELETE /tasks/:id
router.delete('/:id', async (req, res) => {
  const { id } = idSchema.parse(req.params);
  const params: unknown[] = [id];
  const { rowCount } = await query(`DELETE FROM tasks WHERE id = $1 AND ${visibility(req, params)}`, params);
  if (!rowCount) throw notFound('Task');
  res.status(204).end();
});

export default router;
