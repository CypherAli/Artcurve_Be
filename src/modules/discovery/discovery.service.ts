import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Artwork, ArtworkStatus } from '../artworks/entities/artwork.entity';
import { cosineSimilarity, averageEmbedding, hammingHex } from './cosine.util';

export interface SimilarArtwork {
  id: string;
  title: string;
  image_uri: string | null;
  score: number; // cosine 0..1
}

export interface DuplicateHit {
  id: string;
  title: string;
  cosine: number;
  hamming: number; // MAX nếu không so được
}

/**
 * Lớp khám phá dựa trên embedding (một embedding tính một lần, đọc lại nhiều kiểu):
 *   - fingerprint(): gọi Artcurve_AI lấy phash + embedding + tag, lưu vào artwork
 *   - findDuplicates(): dup-guard — chống token 2 lần / trộm tranh
 *   - findSimilar(): "tranh tương tự"
 *   - recommend(): "dành cho bạn" (trung bình embedding các seed)
 *
 * Cosine chạy ở tầng app (jsonb, không pgvector) — đủ nhanh ở quy mô sàn này.
 */
@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly aiUrl: string;

  // Ngưỡng: cosine cao HOẶC hamming thấp = nghi trùng
  private readonly DUP_COSINE = 0.92;
  private readonly DUP_HAMMING = 8;

  constructor(
    @InjectRepository(Artwork) private readonly artworkRepo: Repository<Artwork>,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.aiUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
  }

  /**
   * Tải ảnh về rồi gọi Artcurve_AI /similarity + /tag, lưu vân tay vào artwork.
   * Bọc try/catch: AI service chưa chạy thì bỏ qua (không chặn luồng tạo artwork).
   */
  async fingerprint(artworkId: string, imageUrl: string): Promise<void> {
    const resolved = imageUrl?.startsWith('ipfs://')
      ? imageUrl.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/')
      : imageUrl;
    if (!resolved?.startsWith('http')) return;

    try {
      const imgRes = await firstValueFrom(
        this.http.get(resolved, { responseType: 'arraybuffer' }),
      );
      const blob = new Blob([imgRes.data as ArrayBuffer]);

      const simForm = new FormData();
      simForm.append('file', blob, 'art.png');
      const sim = await firstValueFrom(this.http.post(`${this.aiUrl}/similarity`, simForm));

      const tagForm = new FormData();
      tagForm.append('file', blob, 'art.png');
      const tag = await firstValueFrom(this.http.post(`${this.aiUrl}/tag`, tagForm));

      await this.artworkRepo.update(artworkId, {
        phash: sim.data?.phash ?? null,
        embedding: sim.data?.embedding ?? null,
        style_tags: tag.data?.styles ?? null,
        mood: tag.data?.mood ?? null,
        palette: tag.data?.palette ?? null,
      });
      this.logger.log(`[Discovery] fingerprinted artwork=${artworkId} mode=${sim.data?.mode}`);
    } catch (err: any) {
      this.logger.warn(`[Discovery] fingerprint bỏ qua cho ${artworkId}: ${err.message}`);
    }
  }

  /** Dup-guard: tìm tranh đã có trên sàn giống bức mới (cosine cao hoặc hamming thấp). */
  async findDuplicates(embedding: number[] | null, phash: string | null): Promise<DuplicateHit[]> {
    if (!embedding && !phash) return [];
    const rows = await this.artworkRepo.find({
      select: ['id', 'title', 'embedding', 'phash'],
      where: { embedding: Not(IsNull()) },
    });

    const hits: DuplicateHit[] = [];
    for (const r of rows) {
      const cos = embedding && r.embedding ? cosineSimilarity(embedding, r.embedding) : 0;
      const ham = phash && r.phash ? hammingHex(phash, r.phash) : Number.MAX_SAFE_INTEGER;
      if (cos >= this.DUP_COSINE || ham <= this.DUP_HAMMING) {
        hits.push({ id: r.id, title: r.title, cosine: round(cos), hamming: ham });
      }
    }
    return hits.sort((a, b) => b.cosine - a.cosine);
  }

  /** "Tranh tương tự" bức cho trước — top-k gần nhất (loại chính nó). */
  async findSimilar(artworkId: string, limit = 12): Promise<SimilarArtwork[]> {
    const target = await this.artworkRepo.findOne({
      where: { id: artworkId },
      select: ['id', 'embedding'],
    });
    if (!target) throw new NotFoundException('Artwork không tồn tại');
    if (!target.embedding) return []; // chưa fingerprint

    return this.nearest(target.embedding, limit, [artworkId]);
  }

  /** "Dành cho bạn" — trung bình embedding các seed (tranh user đã thích/giữ). */
  async recommend(seedArtworkIds: string[], limit = 12): Promise<SimilarArtwork[]> {
    if (!seedArtworkIds?.length) return [];
    const seeds = await this.artworkRepo.find({
      select: ['embedding'],
      where: seedArtworkIds.map((id) => ({ id })),
    });
    const avg = averageEmbedding(
      seeds.map((s) => s.embedding).filter((e): e is number[] => Array.isArray(e)),
    );
    if (!avg) return [];
    return this.nearest(avg, limit, seedArtworkIds);
  }

  /** Lõi nearest-neighbor: cosine với mọi artwork ACTIVE có embedding, loại excludeIds. */
  private async nearest(query: number[], limit: number, excludeIds: string[]): Promise<SimilarArtwork[]> {
    const rows = await this.artworkRepo.find({
      select: ['id', 'title', 'image_uri', 'embedding'],
      where: { embedding: Not(IsNull()), status: ArtworkStatus.ACTIVE },
    });
    const exclude = new Set(excludeIds);
    return rows
      .filter((r) => r.embedding && !exclude.has(r.id))
      .map((r) => ({
        id: r.id,
        title: r.title,
        image_uri: r.image_uri,
        score: round(cosineSimilarity(query, r.embedding as number[])),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}
