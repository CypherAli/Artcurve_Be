// ─────────────────────────────────────────────────────────────────────────────
//  Keyset (cursor) pagination helpers.
//
//  Vì sao keyset thay vì OFFSET ở quy mô thực tế:
//    - OFFSET N phải quét + bỏ qua N dòng → trang sâu (page 10000) cực chậm.
//    - Keyset dùng điều kiện WHERE (sort_key, id) < (cursor) → luôn O(limit)
//      bất kể ở trang nào, tận dụng index trực tiếp.
//
//  Cursor mã hoá tuple (timestamp, id) của bản ghi cuối trang hiện tại,
//  base64url để an toàn khi truyền qua URL/query.
// ─────────────────────────────────────────────────────────────────────────────

export interface DecodedCursor {
  ts: string;   // ISO timestamp của bản ghi cuối
  id: string;   // id (tiebreaker, đảm bảo thứ tự ổn định khi timestamp trùng)
}

export interface CursorPage<T> {
  data:        T[];
  next_cursor: string | null;   // null = hết dữ liệu
  has_more:    boolean;
}

export function encodeCursor(timestamp: Date | string, id: string): string {
  const iso = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
  return Buffer.from(`${iso}|${id}`, 'utf-8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): DecodedCursor | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf-8');
    const sep = raw.lastIndexOf('|');
    if (sep < 0) return null;
    const ts = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (!ts || !id || isNaN(Date.parse(ts))) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

/**
 * Cho query lấy `limit + 1` dòng (DESC theo timestamp,id): cắt phần thừa và
 * dựng cursor trang kế. `getKey` trích (timestamp, id) từ 1 row.
 */
export function buildCursorPage<T>(
  rows: T[],
  limit: number,
  getKey: (row: T) => { ts: Date | string; id: string },
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor(getKey(last).ts, getKey(last).id)
    : null;
  return { data, next_cursor: nextCursor, has_more: hasMore };
}
