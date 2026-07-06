import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { DiscoveryService } from './discovery.service';

@ApiTags('discovery')
@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public() // duyệt tranh tương tự — công khai như marketplace
  @Get('artworks/:id/similar')
  @ApiOperation({ summary: 'Tranh tương tự (cosine trên CLIP embedding)' })
  async similar(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.discovery.findSimilar(id, clampLimit(limit));
  }

  @Public()
  @Get('artworks/:id/duplicates')
  @ApiOperation({ summary: 'Dup-guard: bức đã có trên sàn giống bức này (cosine cao / phash gần)' })
  async duplicates(@Param('id', ParseUUIDPipe) id: string) {
    return this.discovery.findDuplicatesOf(id);
  }

  @Public()
  @Get('discovery/recommend')
  @ApiOperation({ summary: 'Gợi ý từ các seed (tranh đã thích/giữ) — trung bình embedding' })
  @ApiQuery({ name: 'seeds', description: 'CSV các artworkId', required: true })
  async recommend(
    @Query('seeds') seeds: string,
    @Query('limit') limit?: string,
  ) {
    const ids = (seeds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.discovery.recommend(ids, clampLimit(limit));
  }
}

function clampLimit(v?: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 12;
  return Math.min(Math.max(Math.trunc(n), 1), 50);
}
