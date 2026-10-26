import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { query } from '../db';
import { HttpError } from '../errors';
import { authenticate, signToken, type CurrentUser } from '../middleware/auth';

const router = Router();

// Slows password guessing: 10 failed attempts per IP per 15 minutes.
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true });

const email = z.string().trim().toLowerCase().email().max(254);
const registerSchema = z.object({
  email,
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(72),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(72) });

// Compared against when the email is unknown, so both cases take the same time.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

router.post('/register', limiter, async (req, res) => {
  const { email, name, password } = registerSchema.parse(req.body);
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query<CurrentUser>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, name, role`,
    [email, name, hash],
  );
  if (!rows[0]) throw new HttpError(409, 'email_taken', 'An account with this email already exists');
  res.status(201).json({ token: signToken(rows[0].id), user: rows[0] });
});

router.post('/login', limiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const { rows } = await query<CurrentUser & { password_hash: string }>(
    'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
    [email],
  );
  const found = rows[0];
  const ok = await bcrypt.compare(password, found?.password_hash ?? DUMMY_HASH);
  if (!found || !ok) throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
  const { password_hash: _, ...user } = found;
  res.json({ token: signToken(user.id), user });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;
