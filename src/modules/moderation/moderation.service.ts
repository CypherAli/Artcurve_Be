import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository }   from '@nestjs/typeorm'
import { Repository }         from 'typeorm'
import { HttpService }        from '@nestjs/axios'
import { ConfigService }      from '@nestjs/config'
import { firstValueFrom }     from 'rxjs'
import { ModerationLog }      from '../artworks/entities/moderation-log.entity'
import { Artwork, ArtworkStatus } from '../artworks/entities/artwork.entity'

export type ModerationResult = 'approved' | 'rejected' | 'manual_review'

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name)

  constructor(
    @InjectRepository(ModerationLog) private readonly logRepo: Repository<ModerationLog>,
    @InjectRepository(Artwork)       private readonly artworkRepo: Repository<Artwork>,
    private readonly httpService: HttpService,
    private readonly config:      ConfigService,
  ) {}

  /**
   * Submit artwork for AI moderation.
   * Calls external AI API (OpenAI Moderation) to check:
   *   - Prohibited content (NSFW, violence)
   *   - Quality standards
   *
   * Falls back to 'approved' in dev when no API key is configured.
   */
  async moderateArtwork(artworkId: string, imageUrl: string): Promise<ModerationResult> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')

    let result: ModerationResult = 'approved'
    let reason  = 'Auto-approved (no moderation API configured)'
    let score   = 0

    // Resolve ipfs:// → https gateway để OpenAI fetch được ảnh
    const resolvedUrl = imageUrl?.startsWith('ipfs://')
      ? imageUrl.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/')
      : imageUrl

    if (apiKey && resolvedUrl?.startsWith('http')) {
      try {
        // omni-moderation-latest hỗ trợ multimodal: check trực tiếp nội dung ẢNH
        // qua image_url (model cũ text-moderation chỉ nhận text → vô dụng với artwork)
        const response = await firstValueFrom(
          this.httpService.post(
            'https://api.openai.com/v1/moderations',
            {
              model: 'omni-moderation-latest',
              input: [{ type: 'image_url', image_url: { url: resolvedUrl } }],
            },
            { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } },
          ),
        )
        const flagged = response.data?.results?.[0]?.flagged ?? false
        const categoryScores = response.data?.results?.[0]?.category_scores ?? {}
        score  = Math.max(0, ...Object.values(categoryScores) as number[])
        result = flagged ? 'rejected' : 'approved'
        reason = flagged ? 'AI flagged content as prohibited' : 'AI moderation passed'
        this.logger.log(`[Moderation] artwork=${artworkId} result=${result} score=${score.toFixed(4)}`)
      } catch (err: any) {
        this.logger.warn(`[Moderation] API error for ${artworkId}: ${err.message} — defaulting to manual_review`)
        result = 'manual_review'
        reason = `Moderation API error: ${err.message}`
      }
    }

    // Map result to ModerationLog action_taken
    const actionTaken =
      result === 'approved'      ? 'APPROVED'      :
      result === 'rejected'      ? 'REJECTED'       :
                                   'MANUAL_REVIEW'

    // Log result — ai_confidence_score is DECIMAL(5,2) so multiply score (0-1) to percentage
    await this.logRepo.save({
      artwork_id:           artworkId,
      action_taken:         actionTaken,
      reason,
      ai_confidence_score:  (score * 100).toFixed(2),
    })

    // State machine: DRAFT → AI_MODERATING (khi submit) → ACTIVE (khi pass) / DRAFT (khi reject)
    // moderateArtwork được gọi SAU KHI artwork đã ở trạng thái AI_MODERATING.
    // Nếu pass → ACTIVE (chờ deploy contract).
    // Nếu reject → DRAFT (artist sửa lại).
    // Nếu manual_review → giữ nguyên AI_MODERATING (admin xử lý thủ công).
    if (result === 'approved') {
      await this.artworkRepo.update(artworkId, { status: ArtworkStatus.ACTIVE })
    } else if (result === 'rejected') {
      await this.artworkRepo.update(artworkId, { status: ArtworkStatus.DRAFT })
    }
    // manual_review: không đổi status — admin sẽ review thủ công

    return result
  }

  async getLogs(artworkId: string): Promise<ModerationLog[]> {
    return this.logRepo.find({ where: { artwork_id: artworkId }, order: { created_at: 'DESC' } })
  }
}
