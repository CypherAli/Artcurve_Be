import { Injectable, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, DataSource } from 'typeorm'
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
    await this.interactionRepo.save({ user_id: userId, artwork_id: artworkId, interaction_type: 'LIKE' })
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
    const [likeCount, comments] = await Promise.all([
      this.interactionRepo.count({ where: { artwork_id: artworkId, interaction_type: 'LIKE' } }),
      this.interactionRepo.find({
        where:  { artwork_id: artworkId, interaction_type: 'COMMENT' },
        select: ['rating'],
      }),
    ])

    const rated = comments.filter(c => c.rating !== null)
    const avgRating = rated.length > 0
      ? rated.reduce((sum, c) => sum + (c.rating as number), 0) / rated.length
      : null

    return {
      like_count:    likeCount,
      comment_count: comments.length,
      avg_rating:    avgRating !== null ? Math.round(avgRating * 10) / 10 : null,
    }
  }
}
