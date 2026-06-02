import { Injectable, ConflictException, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository }       from 'typeorm'
import { Follower }         from './entities/follower.entity'
import { SocialInteraction } from './entities/social-interaction.entity'

@Injectable()
export class SocialService {
  constructor(
    @InjectRepository(Follower)
    private readonly followerRepo: Repository<Follower>,
    @InjectRepository(SocialInteraction)
    private readonly interactionRepo: Repository<SocialInteraction>,
  ) {}

  async follow(followerId: string, followingId: string): Promise<void> {
    if (followerId === followingId) throw new ConflictException('Không thể tự follow bản thân.')
    const existing = await this.followerRepo.findOne({
      where: { follower_id: followerId, following_id: followingId },
    })
    if (existing) throw new ConflictException('Đã follow rồi.')
    await this.followerRepo.save({ follower_id: followerId, following_id: followingId })
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

  async getLikeCount(artworkId: string): Promise<number> {
    return this.interactionRepo.count({ where: { artwork_id: artworkId, interaction_type: 'LIKE' } })
  }
}
