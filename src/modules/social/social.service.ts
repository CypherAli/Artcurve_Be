import { Injectable, ConflictException, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, DataSource, QueryFailedError } from 'typeorm'
import { Follower }         from './entities/follower.entity'
import { SocialInteraction } from './entities/social-interaction.entity'
import { NotificationsService } from '../notifications/notifications.service'

@Injectable()
export class SocialService {
  constructor(
    @InjectRepository(Follower)
    private readonly followerRepo: Repository<Follower>,
    @InjectRepository(SocialInteraction)
    private readonly interactionRepo: Repository<SocialInteraction>,
    private readonly notifSvc:  NotificationsService,
    private readonly ds:        DataSource,
  ) {}

  // ── Follow ──────────────────────────────────────────────────────────

  async follow(followerId: string, followingId: string): Promise<void> {
    if (followerId === followingId) throw new ConflictException('Không thể tự follow bản thân.')
    const existing = await this.followerRepo.findOne({
      where: { follower_id: followerId, following_id: followingId },
    })
    if (existing) throw new ConflictException('Đã follow rồi.')
    await this.followerRepo.save({ follower_id: followerId, following_id: followingId })

    // Gửi thông báo cho người được follow
    const follower = await this.ds.query(
      `SELECT username, wallet_address FROM users WHERE id = $1`, [followerId]
    )
    const name = follower[0]?.username ?? follower[0]?.wallet_address?.slice(0, 10) ?? 'Someone'
    this.notifSvc.create({
      user_id:     followingId,
      type:        'follow',
      title:       `${name} đã follow bạn`,
      description: 'Xem bộ sưu tập của họ',
      metadata:    { follower_id: followerId },
    }).catch(() => {})
  }

  async unfollow(followerId: string, followingId: string): Promise<void> {
    const result = await this.followerRepo.delete({ follower_id: followerId, following_id: followingId })
    if (!result.affected) throw new NotFoundException('Chưa follow người dùng này.')
  }

  async getFollowers(userId: string): Promise<Follower[]> {
    return this.followerRepo.find({ where: { following_id: userId }, relations: ['follower'] })
  }

  async getFollowing(userId: string): Promise<Follower[]> {
    return this.followerRepo.find({ where: { follower_id: userId }, relations: ['following_user'] })
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    return !!(await this.followerRepo.findOne({ where: { follower_id: followerId, following_id: followingId } }))
  }

  // ── Likes ───────────────────────────────────────────────────────────

  async likeArtwork(userId: string, artworkId: string): Promise<void> {
    const existing = await this.interactionRepo.findOne({
      where: { user_id: userId, artwork_id: artworkId, interaction_type: 'LIKE' },
    })
    if (existing) throw new ConflictException('Đã like rồi.')
    try {
      await this.interactionRepo.save({ user_id: userId, artwork_id: artworkId, interaction_type: 'LIKE' })
    } catch (err) {
      // Race: 2 request like đồng thời → unique constraint chặn bản ghi thứ 2.
      // Coi như đã like (idempotent) thay vì trả 500.
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        throw new ConflictException('Đã like rồi.')
      }
      throw err
    }
  }

  async unlikeArtwork(userId: string, artworkId: string): Promise<void> {
    await this.interactionRepo.delete({ user_id: userId, artwork_id: artworkId, interaction_type: 'LIKE' })
  }

  async getLikeCount(artworkId: string): Promise<{ count: number }> {
    const count = await this.interactionRepo.count({
      where: { artwork_id: artworkId, interaction_type: 'LIKE' },
    })
    return { count }
  }

  // ── Comments / Reviews ──────────────────────────────────────────────

  async createComment(
    userId: string,
    artworkId: string,
    content: string,
    rating?: number,
  ): Promise<SocialInteraction> {
    // Guard tại service layer (phòng khi gọi bỏ qua DTO) — DB cũng có CHECK constraint
    if (rating !== undefined && rating !== null && (rating < 1 || rating > 5)) {
      throw new BadRequestException('rating phải nằm trong khoảng 1–5')
    }

    // Dedup: cùng user, cùng artwork, cùng content trong 30 giây → trả về comment cũ
    const thirtySecondsAgo = new Date(Date.now() - 30_000)
    const duplicate = await this.interactionRepo
      .createQueryBuilder('si')
      .where('si.user_id = :userId', { userId })
      .andWhere('si.artwork_id = :artworkId', { artworkId })
      .andWhere('si.interaction_type = :type', { type: 'COMMENT' })
      .andWhere('si.content = :content', { content })
      .andWhere('si.created_at > :since', { since: thirtySecondsAgo })
      .getOne()
    if (duplicate) return duplicate

    const interaction = this.interactionRepo.create({
      user_id:          userId,
      artwork_id:       artworkId,
      interaction_type: 'COMMENT',
      content,
      rating:           rating ?? null,
    })
    return this.interactionRepo.save(interaction)
  }

  async getComments(
    artworkId: string,
    page  = 1,
    limit = 20,
  ): Promise<SocialInteraction[]> {
    return this.interactionRepo.find({
      where:     { artwork_id: artworkId, interaction_type: 'COMMENT' },
      relations: ['user'],
      order:     { created_at: 'DESC' },
      take:      Math.min(limit, 100),
      skip:      (page - 1) * Math.min(limit, 100),
    })
  }

  async deleteComment(userId: string, commentId: string): Promise<void> {
    const comment = await this.interactionRepo.findOne({
      where: { id: commentId, interaction_type: 'COMMENT' },
    })
    if (!comment) throw new NotFoundException('Comment không tồn tại.')
    if (comment.user_id !== userId) throw new ForbiddenException('Không có quyền xóa comment này.')
    await this.interactionRepo.remove(comment)
  }

  async getArtworkStats(artworkId: string): Promise<{
    like_count:    number
    comment_count: number
    avg_rating:    number | null
  }> {
    // 1 query aggregation thay vì fetch toàn bộ comment rồi tính in-memory (tránh N+1/full scan)
    const row = await this.interactionRepo
      .createQueryBuilder('si')
      .select(`COUNT(*) FILTER (WHERE si.interaction_type = 'LIKE')`,    'like_count')
      .addSelect(`COUNT(*) FILTER (WHERE si.interaction_type = 'COMMENT')`, 'comment_count')
      .addSelect(`AVG(si.rating) FILTER (WHERE si.interaction_type = 'COMMENT' AND si.rating IS NOT NULL)`, 'avg_rating')
      .where('si.artwork_id = :id', { id: artworkId })
      .getRawOne<{ like_count: string; comment_count: string; avg_rating: string | null }>()

    const avg = row?.avg_rating != null ? parseFloat(row.avg_rating) : null

    return {
      like_count:    parseInt(row?.like_count ?? '0', 10),
      comment_count: parseInt(row?.comment_count ?? '0', 10),
      avg_rating:    avg !== null ? Math.round(avg * 10) / 10 : null,
    }
  }
}
