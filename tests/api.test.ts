import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { migrate, pool, query } from '../src/db';

const app = createApp();
const api = () => request(app);

async function register(name: string) {
  const res = await api()
    .post('/auth/register')
    .send({ email: `${name}@example.com`, name, password: 'password-123' })
    .expect(201);
  return { token: res.body.token as string, id: res.body.user.id as number };
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let ann: { token: string; id: number };
let bob: { token: string; id: number };
let admin: { token: string; id: number };

beforeAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS api_test CASCADE');
  await migrate();
  ann = await register('ann');
  bob = await register('bob');
  admin = await register('admin');
  await query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.id]);
});

afterAll(() => pool.end());

describe('auth', () => {
  it('rejects a duplicate email', async () => {
    const res = await api().post('/auth/register').send({ email: 'ANN@example.com', name: 'x', password: 'password-123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_taken');
  });

  it('validates input and reports the field', async () => {
    const res = await api().post('/auth/register').send({ email: 'not-an-email', name: '', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(['email', 'name', 'password']);
  });

  it('logs in with the right password only', async () => {
    await api().post('/auth/login').send({ email: 'ann@example.com', password: 'wrong-password' }).expect(401);
    const res = await api().post('/auth/login').send({ email: 'Ann@Example.com', password: 'password-123' }).expect(200);
    expect(res.body.user).toEqual({ id: ann.id, email: 'ann@example.com', name: 'ann', role: 'user' });
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('protects routes and rejects forged tokens', async () => {
    await api().get('/tasks').expect(401);
    const forged = jwt.sign({ sub: String(admin.id) }, 'not-the-secret');
    await api().get('/tasks').set(bearer(forged)).expect(401);
    const me = await api().get('/auth/me').set(bearer(ann.token)).expect(200);
    expect(me.body.user.id).toBe(ann.id);
  });
});

describe('tasks', () => {
  let taskId: number;

  it('creates a task with defaults', async () => {
    const res = await api().post('/tasks').set(bearer(ann.token)).send({ title: 'Write docs' }).expect(201);
    expect(res.body).toMatchObject({ title: 'Write docs', status: 'todo', priority: 'medium', due_date: null, owner_id: ann.id });
    taskId = res.body.id;
  });

  it('keeps due dates exactly as sent', async () => {
    const res = await api().post('/tasks').set(bearer(ann.token)).send({ title: 'Pay rent', due_date: '2026-12-31', priority: 'high' }).expect(201);
    expect(res.body.due_date).toBe('2026-12-31');
  });

  it('rejects bad input', async () => {
    const res = await api().post('/tasks').set(bearer(ann.token)).send({ title: '', status: 'later', due_date: '31.12.2026' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('updates only the fields that are sent', async () => {
    const res = await api().patch(`/tasks/${taskId}`).set(bearer(ann.token)).send({ status: 'in_progress' }).expect(200);
    expect(res.body).toMatchObject({ title: 'Write docs', status: 'in_progress' });
    expect(new Date(res.body.updated_at) >= new Date(res.body.created_at)).toBe(true);
    await api().patch(`/tasks/${taskId}`).set(bearer(ann.token)).send({}).expect(400);
  });

  it("hides other users' tasks", async () => {
    await api().get(`/tasks/${taskId}`).set(bearer(bob.token)).expect(404);
    await api().patch(`/tasks/${taskId}`).set(bearer(bob.token)).send({ title: 'hacked' }).expect(404);
    await api().delete(`/tasks/${taskId}`).set(bearer(bob.token)).expect(404);
    const list = await api().get('/tasks').set(bearer(bob.token)).expect(200);
    expect(list.body.total).toBe(0);
  });

  it('returns 404 for unknown and malformed ids', async () => {
    await api().get('/tasks/999999').set(bearer(ann.token)).expect(404);
    await api().get('/tasks/abc').set(bearer(ann.token)).expect(400);
  });

  it('deletes a task', async () => {
    const res = await api().post('/tasks').set(bearer(ann.token)).send({ title: 'Temporary' }).expect(201);
    await api().delete(`/tasks/${res.body.id}`).set(bearer(ann.token)).expect(204);
    await api().get(`/tasks/${res.body.id}`).set(bearer(ann.token)).expect(404);
  });
});

describe('listing', () => {
  beforeAll(async () => {
    const tasks = [
      { title: 'Buy milk', priority: 'low', status: 'done', due_date: '2026-01-10' },
      { title: 'Fix login bug', priority: 'high', description: 'Users cannot log in', due_date: '2026-02-01' },
      { title: '100% coverage', priority: 'medium', due_date: '2026-03-01' },
      { title: 'Plan sprint', priority: 'high', status: 'in_progress' },
    ];
    for (const t of tasks) await api().post('/tasks').set(bearer(bob.token)).send(t).expect(201);
  });

  const list = (qs: string) => api().get(`/tasks?${qs}`).set(bearer(bob.token)).expect(200);

  it('filters by status and priority', async () => {
    expect((await list('status=done')).body.data.map((t: { title: string }) => t.title)).toEqual(['Buy milk']);
    expect((await list('priority=high')).body.total).toBe(2);
  });

  it('searches title and description, treating % literally', async () => {
    expect((await list('q=log in')).body.data[0].title).toBe('Fix login bug');
    expect((await list('q=100%25')).body.total).toBe(1);
    expect((await list('q=%25%25')).body.total).toBe(0);
  });

  it('filters by due date range', async () => {
    const res = await list('due_after=2026-01-15&due_before=2026-02-28');
    expect(res.body.data.map((t: { title: string }) => t.title)).toEqual(['Fix login bug']);
  });

  it('sorts by priority and puts tasks without a due date last', async () => {
    const byPriority = (await list('sort=priority&order=asc')).body.data.map((t: { priority: string }) => t.priority);
    expect(byPriority).toEqual(['low', 'medium', 'high', 'high']);
    const byDue = (await list('sort=due_date&order=asc')).body.data.map((t: { title: string }) => t.title);
    expect(byDue.at(-1)).toBe('Plan sprint');
  });

  it('paginates without overlap', async () => {
    const p1 = await list('limit=3&page=1&sort=title&order=asc');
    const p2 = await list('limit=3&page=2&sort=title&order=asc');
    expect(p1.body).toMatchObject({ page: 1, limit: 3, total: 4, totalPages: 2 });
    expect(p2.body.data).toHaveLength(1);
    const ids = [...p1.body.data, ...p2.body.data].map((t: { id: number }) => t.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('rejects unknown sort fields and huge pages', async () => {
    await api().get('/tasks?sort=password_hash').set(bearer(bob.token)).expect(400);
    await api().get('/tasks?limit=1000').set(bearer(bob.token)).expect(400);
  });

  it('lets only admins filter by owner', async () => {
    await api().get(`/tasks?owner_id=${ann.id}`).set(bearer(bob.token)).expect(403);
    const res = await api().get(`/tasks?owner_id=${bob.id}`).set(bearer(admin.token)).expect(200);
    expect(res.body.total).toBe(4);
  });
});

describe('admin', () => {
  it('sees every task and every user', async () => {
    const tasks = await api().get('/tasks?limit=100').set(bearer(admin.token)).expect(200);
    expect(new Set(tasks.body.data.map((t: { owner_id: number }) => t.owner_id))).toEqual(new Set([ann.id, bob.id]));
    const users = await api().get('/users').set(bearer(admin.token)).expect(200);
    expect(users.body.total).toBe(3);
    expect(users.body.data.find((u: { id: number }) => u.id === bob.id).task_count).toBe(4);
  });

  it('is required for user management', async () => {
    await api().get('/users').set(bearer(ann.token)).expect(403);
    await api().patch(`/users/${bob.id}/role`).set(bearer(ann.token)).send({ role: 'admin' }).expect(403);
  });

  it('changes roles, and the change applies to existing tokens at once', async () => {
    await api().patch(`/users/${ann.id}/role`).set(bearer(admin.token)).send({ role: 'admin' }).expect(200);
    await api().get('/users').set(bearer(ann.token)).expect(200);
    await api().patch(`/users/${ann.id}/role`).set(bearer(admin.token)).send({ role: 'user' }).expect(200);
    await api().get('/users').set(bearer(ann.token)).expect(403);
    await api().patch(`/users/${admin.id}/role`).set(bearer(admin.token)).send({ role: 'user' }).expect(400);
  });

  it('deletes a user with their tasks; their token stops working', async () => {
    await api().delete(`/users/${bob.id}`).set(bearer(admin.token)).expect(204);
    await api().get('/tasks').set(bearer(bob.token)).expect(401);
    const res = await api().get(`/tasks?owner_id=${bob.id}`).set(bearer(admin.token)).expect(200);
    expect(res.body.total).toBe(0);
  });
});

describe('system', () => {
  it('reports health and serves docs', async () => {
    await api().get('/health').expect(200, { status: 'ok' });
    const spec = await api().get('/openapi.json').expect(200);
    expect(spec.body.openapi).toBe('3.1.0');
    await api().get('/docs/').expect(200);
  });

  it('answers unknown routes and bad JSON with the standard error shape', async () => {
    const missing = await api().get('/nope').expect(404);
    expect(missing.body.error.code).toBe('not_found');
    const bad = await api().post('/auth/login').set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(bad.body.error.code).toBe('invalid_json');
  });
});
