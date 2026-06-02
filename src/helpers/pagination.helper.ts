// ─────────────────────────────────────────────────────────────────
//  helpers/pagination.helper.ts
//  Standardised paginated response builder
// ─────────────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  data:  T[]
  total: number
  page:  number
  limit: number
  pages: number
}

export function paginate<T>(
  data:  T[],
  total: number,
  page:  number,
  limit: number,
): PaginatedResult<T> {
  return {
    data,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  }
}

export function paginationParams(
  rawPage  = '1',
  rawLimit = '20',
  maxLimit = 100,
): { page: number; limit: number; skip: number } {
  const page  = Math.max(1, parseInt(rawPage,  10) || 1)
  const limit = Math.min(maxLimit, Math.max(1, parseInt(rawLimit, 10) || 20))
  return { page, limit, skip: (page - 1) * limit }
}
