import { encodeCursor, decodeCursor, buildCursorPage } from './cursor.util';

describe('cursor.util', () => {
  it('encode → decode round-trip giữ nguyên ts + id', () => {
    const ts = '2026-06-17T10:00:00.000Z';
    const id = 'abc-123';
    const decoded = decodeCursor(encodeCursor(ts, id));
    expect(decoded).toEqual({ ts, id });
  });

  it('decode cursor rỗng/sai → null', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('@@@không-phải-base64-hợp-lệ@@@')).toBeNull();
    expect(decodeCursor(Buffer.from('không-có-separator').toString('base64url'))).toBeNull();
  });

  it('buildCursorPage: còn trang sau → cắt limit + có next_cursor', () => {
    const rows = [
      { id: '1', ts: '2026-06-17T03:00:00.000Z' },
      { id: '2', ts: '2026-06-17T02:00:00.000Z' },
      { id: '3', ts: '2026-06-17T01:00:00.000Z' }, // dòng thừa (limit=2)
    ];
    const page = buildCursorPage(rows, 2, (r) => ({ ts: r.ts, id: r.id }));
    expect(page.data).toHaveLength(2);
    expect(page.has_more).toBe(true);
    expect(decodeCursor(page.next_cursor!)).toEqual({ ts: '2026-06-17T02:00:00.000Z', id: '2' });
  });

  it('buildCursorPage: hết dữ liệu → next_cursor null', () => {
    const rows = [{ id: '1', ts: '2026-06-17T03:00:00.000Z' }];
    const page = buildCursorPage(rows, 5, (r) => ({ ts: r.ts, id: r.id }));
    expect(page.has_more).toBe(false);
    expect(page.next_cursor).toBeNull();
    expect(page.data).toHaveLength(1);
  });
});
