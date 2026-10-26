// OpenAPI 3.1 description of the API, served at /openapi.json and rendered at /docs.

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ content: { 'application/json': { schema } } });
const error = (description: string) => ({ description, ...json(ref('Error')) });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];
const page = (item: string) => ({
  type: 'object',
  properties: {
    data: { type: 'array', items: ref(item) },
    page: { type: 'integer' },
    limit: { type: 'integer' },
    total: { type: 'integer' },
    totalPages: { type: 'integer' },
  },
});
const taskWritable = {
  title: { type: 'string', minLength: 1, maxLength: 200, example: 'Write the API docs' },
  description: { type: 'string', maxLength: 5000, example: 'OpenAPI + Swagger UI' },
  status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
  priority: { type: 'string', enum: ['low', 'medium', 'high'] },
  due_date: { type: ['string', 'null'], format: 'date', example: '2026-12-31' },
};
const auth = [{ bearer: [] }];

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Task Manager API',
    version: '1.0.0',
    description:
      'REST API for personal task management with JWT authentication and roles.\n\n' +
      '**Try it:** `POST /auth/register` → copy the `token` → **Authorize** (top right) → call the task endpoints.\n\n' +
      'Users see and change only their own tasks; admins see all tasks and manage users. ' +
      'The free server sleeps when idle — the first request may take up to a minute.',
  },
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'validation_error' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: { id: { type: 'integer' }, email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', enum: ['user', 'admin'] } },
      },
      Auth: { type: 'object', properties: { token: { type: 'string' }, user: ref('User') } },
      Task: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          owner_id: { type: 'integer' },
          ...taskWritable,
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      NewTask: { type: 'object', required: ['title'], properties: taskWritable },
      TaskPatch: { type: 'object', minProperties: 1, properties: taskWritable },
    },
  },
  paths: {
    '/health': {
      get: { tags: ['System'], summary: 'Liveness and database check', responses: { 200: { description: 'OK' }, 503: { description: 'Database unavailable' } } },
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account',
        requestBody: {
          required: true,
          ...json({
            type: 'object',
            required: ['email', 'name', 'password'],
            properties: {
              email: { type: 'string', format: 'email', example: 'you@example.com' },
              name: { type: 'string', example: 'Ann' },
              password: { type: 'string', minLength: 8, example: 'correct-horse-1' },
            },
          }),
        },
        responses: { 201: { description: 'Created', ...json(ref('Auth')) }, 400: error('Validation error'), 409: error('Email taken') },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Get a token',
        requestBody: {
          required: true,
          ...json({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } }),
        },
        responses: { 200: { description: 'OK', ...json(ref('Auth')) }, 401: error('Wrong email or password') },
      },
    },
    '/auth/me': {
      get: { tags: ['Auth'], summary: 'Current user', security: auth, responses: { 200: { description: 'OK' }, 401: error('Not signed in') } },
    },
    '/tasks': {
      get: {
        tags: ['Tasks'],
        summary: 'List tasks (own; all for admins) with filters, search, sorting and pagination',
        security: auth,
        parameters: [
          ...pageParams,
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['todo', 'in_progress', 'done'] } },
          { name: 'priority', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high'] } },
          { name: 'q', in: 'query', description: 'Search in title and description', schema: { type: 'string' } },
          { name: 'due_before', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'due_after', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['created_at', 'due_date', 'title', 'priority'], default: 'created_at' } },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
          { name: 'owner_id', in: 'query', description: 'Admins only', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'OK', ...json(page('Task')) }, 400: error('Invalid filter'), 401: error('Not signed in') },
      },
      post: {
        tags: ['Tasks'],
        summary: 'Create a task',
        security: auth,
        requestBody: { required: true, ...json(ref('NewTask')) },
        responses: { 201: { description: 'Created', ...json(ref('Task')) }, 400: error('Validation error'), 422: error('Task limit reached') },
      },
    },
    '/tasks/{id}': {
      parameters: [idParam],
      get: { tags: ['Tasks'], summary: 'Get a task', security: auth, responses: { 200: { description: 'OK', ...json(ref('Task')) }, 404: error('Not found or not yours') } },
      patch: {
        tags: ['Tasks'],
        summary: 'Update some fields of a task',
        security: auth,
        requestBody: { required: true, ...json(ref('TaskPatch')) },
        responses: { 200: { description: 'OK', ...json(ref('Task')) }, 404: error('Not found or not yours') },
      },
      delete: { tags: ['Tasks'], summary: 'Delete a task', security: auth, responses: { 204: { description: 'Deleted' }, 404: error('Not found or not yours') } },
    },
    '/users': {
      get: { tags: ['Admin'], summary: 'List users with their task counts', security: auth, parameters: pageParams, responses: { 200: { description: 'OK' }, 403: error('Admins only') } },
    },
    '/users/{id}/role': {
      parameters: [idParam],
      patch: {
        tags: ['Admin'],
        summary: 'Change a user role',
        security: auth,
        requestBody: { required: true, ...json({ type: 'object', properties: { role: { type: 'string', enum: ['user', 'admin'] } } }) },
        responses: { 200: { description: 'OK' }, 403: error('Admins only') },
      },
    },
    '/users/{id}': {
      parameters: [idParam],
      delete: { tags: ['Admin'], summary: 'Delete a user and their tasks', security: auth, responses: { 204: { description: 'Deleted' }, 403: error('Admins only') } },
    },
  },
};
