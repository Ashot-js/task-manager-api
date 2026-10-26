import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../db';
import { HttpError } from '../errors';

export type Role = 'user' | 'admin';

export interface CurrentUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: CurrentUser;
    }
  }
}

export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.jwtExpiresIn });
}

/**
 * Requires a valid Bearer token. The user (and role) is loaded from the database on
 * every request, so a deleted user or a changed role takes effect immediately.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? '';
  let userId: number;
  try {
    if (!header.startsWith('Bearer ')) throw new Error('missing');
    const payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ['HS256'] }) as { sub: string };
    userId = Number(payload.sub);
  } catch {
    throw new HttpError(401, 'unauthorized', 'Missing or invalid token');
  }

  const { rows } = await query<CurrentUser>('SELECT id, email, name, role FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw new HttpError(401, 'unauthorized', 'User no longer exists');
  req.user = rows[0];
  next();
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.user?.role !== role) throw new HttpError(403, 'forbidden', `Requires the ${role} role`);
    next();
  };
}
