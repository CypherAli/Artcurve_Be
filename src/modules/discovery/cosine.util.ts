/**
 * Toán so khớp cho discovery — thuần, không phụ thuộc DB (unit-test được).
 */

/** Cosine similarity hai vector cùng chiều. Trả 0 nếu lệch chiều/rỗng. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Trung bình nhiều embedding (vector "gu" người dùng). null nếu rỗng. */
export function averageEmbedding(vectors: number[][]): number[] | null {
  const valid = vectors.filter((v) => Array.isArray(v) && v.length > 0);
  if (valid.length === 0) return null;
  const dim = valid[0].length;
  const out = new Array(dim).fill(0);
  for (const v of valid) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  return out.map((x) => x / valid.length);
}

/** Khoảng cách Hamming giữa 2 perceptual hash hex (đếm bit khác nhau). */
export function hammingHex(h1: string, h2: string): number {
  if (!h1 || !h2 || h1.length !== h2.length) return Number.MAX_SAFE_INTEGER;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    let x = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}
