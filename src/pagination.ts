import { z } from 'zod';

export const pageParams = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export function paginated<T>(data: T[], total: number, page: number, limit: number) {
  return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
}
