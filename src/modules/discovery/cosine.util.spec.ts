import { cosineSimilarity, averageEmbedding, hammingHex } from './cosine.util';

describe('cosine.util', () => {
  describe('cosineSimilarity', () => {
    it('vector giống hệt → 1', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    });
    it('vector vuông góc → 0', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    });
    it('vector ngược chiều → -1', () => {
      expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 6);
    });
    it('không phụ thuộc độ dài vector (chỉ hướng)', () => {
      expect(cosineSimilarity([1, 1], [10, 10])).toBeCloseTo(1, 6);
    });
    it('lệch chiều hoặc rỗng → 0', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
      expect(cosineSimilarity([], [])).toBe(0);
    });
  });

  describe('averageEmbedding', () => {
    it('trung bình theo từng chiều', () => {
      expect(averageEmbedding([[0, 0], [2, 4]])).toEqual([1, 2]);
    });
    it('bỏ qua vector rỗng, rỗng hết → null', () => {
      expect(averageEmbedding([[1, 1], []])).toEqual([1, 1]);
      expect(averageEmbedding([])).toBeNull();
    });
  });

  describe('hammingHex', () => {
    it('hash giống hệt → 0', () => {
      expect(hammingHex('ff00', 'ff00')).toBe(0);
    });
    it('đếm đúng số bit khác', () => {
      expect(hammingHex('f', '0')).toBe(4); // 1111 vs 0000
      expect(hammingHex('1', '0')).toBe(1); // 0001 vs 0000
    });
    it('khác độ dài → vô cực', () => {
      expect(hammingHex('ff', 'f')).toBe(Number.MAX_SAFE_INTEGER);
    });
  });
});
