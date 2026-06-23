import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Guild } from './entities/guild.entity';
import { GuildMember, GuildRole } from './entities/guild-member.entity';
import { GuildMessage } from './entities/guild-message.entity';
import { PortfolioHolding } from '../portfolio/entities/portfolio-holding.entity';
import { CreateGuildDto } from './dto/create-guild.dto';
import { UpdateGuildDto } from './dto/update-guild.dto';
import { EventsGateway } from '../gateway/events.gateway';
import { Inject, forwardRef } from '@nestjs/common';

const randomColor = () =>
  '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');

@Injectable()
export class GuildService {
  constructor(
    @InjectRepository(Guild)
    private readonly guildRepo: Repository<Guild>,
    @InjectRepository(GuildMember)
    private readonly memberRepo: Repository<GuildMember>,
    @InjectRepository(GuildMessage)
    private readonly messageRepo: Repository<GuildMessage>,
    @InjectRepository(PortfolioHolding)
    private readonly holdingRepo: Repository<PortfolioHolding>,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
  ) {}

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async requireGuild(guildId: string): Promise<Guild> {
    const guild = await this.guildRepo.findOne({ where: { id: guildId } });
    if (!guild) throw new NotFoundException('Guild not found');
    return guild;
  }

  private async requireMembership(guildId: string, userId: string): Promise<GuildMember> {
    const member = await this.memberRepo.findOne({
      where: { guild_id: guildId, user_id: userId },
    });
    if (!member) throw new ForbiddenException('Not a member of this guild');
    return member;
  }

  private async requireRole(guildId: string, userId: string, roles: GuildRole[]): Promise<GuildMember> {
    const member = await this.requireMembership(guildId, userId);
    if (!roles.includes(member.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return member;
  }

  // ── Create guild ──────────────────────────────────────────────────────────

  async createGuild(userId: string, userName: string, dto: CreateGuildDto) {
    return this.guildRepo.manager.transaction(async (em) => {
      const guild = em.create(Guild, {
        name: dto.name,
        description: dto.description ?? null,
        focus: dto.focus,
        creator_id: userId,
        member_count: 1,
        level: 1,
        max_members: dto.max_members ?? 30,
        acceptance: dto.acceptance ?? 'auto',
        avatar_color: randomColor(),
      });
      const saved = await em.save(guild);

      await em.insert(GuildMember, {
        guild_id: saved.id,
        user_id: userId,
        role: GuildRole.OWNER,
      });

      return saved;
    });
  }

  // ── Update guild settings ─────────────────────────────────────────────────

  async updateGuild(guildId: string, userId: string, dto: UpdateGuildDto) {
    await this.requireRole(guildId, userId, [GuildRole.OWNER]);
    const guild = await this.requireGuild(guildId);

    if (dto.name !== undefined) guild.name = dto.name;
    if (dto.description !== undefined) guild.description = dto.description;
    if (dto.focus !== undefined) guild.focus = dto.focus;
    if (dto.max_members !== undefined) {
      if (dto.max_members < guild.member_count) {
        throw new BadRequestException(
          `Cannot set max_members (${dto.max_members}) below current member count (${guild.member_count})`,
        );
      }
      guild.max_members = dto.max_members;
    }
    if (dto.acceptance !== undefined) guild.acceptance = dto.acceptance;

    return this.guildRepo.save(guild);
  }

  // ── Delete guild ──────────────────────────────────────────────────────────

  async deleteGuild(guildId: string, userId: string) {
    await this.requireRole(guildId, userId, [GuildRole.OWNER]);
    await this.guildRepo.delete(guildId);
    return { deleted: true };
  }

  // ── List all guilds ───────────────────────────────────────────────────────

  async listGuilds(page = 1, limit = 20) {
    const take = Math.min(limit, 50);
    const skip = (page - 1) * take;

    const { entities, raw } = await this.guildRepo
      .createQueryBuilder('g')
      .leftJoin('guild_members', 'gm', 'gm.guild_id = g.id')
      .leftJoin('transactions', 't',
        "t.user_id = gm.user_id AND t.timestamp > NOW() - INTERVAL '7 days'")
      .addSelect('COALESCE(SUM(CAST(t.eth_amount AS DECIMAL(38,18))), 0)', 'weekly_volume_eth')
      .groupBy('g.id')
      .orderBy('g.member_count', 'DESC')
      .skip(skip)
      .take(take)
      .getRawAndEntities();

    const total = await this.guildRepo.count();

    return {
      data: entities.map((g, i) => ({
        ...g,
        weekly_volume_eth: Number(raw[i]?.weekly_volume_eth ?? 0),
      })),
      total,
      page,
      limit: take,
    };
  }

  // ── My guilds ─────────────────────────────────────────────────────────────

  async myGuilds(userId: string) {
    const memberships = await this.memberRepo.find({
      where: { user_id: userId },
      relations: ['guild'],
    });
    return memberships.map((m) => ({ ...m.guild, myRole: m.role }));
  }

  // ── Single guild detail ───────────────────────────────────────────────────

  async getGuild(guildId: string) {
    return this.requireGuild(guildId);
  }

  // ── Join guild ────────────────────────────────────────────────────────────

  async joinGuild(guildId: string, userId: string) {
    const guild = await this.requireGuild(guildId);

    if (guild.acceptance === 'manual') {
      throw new BadRequestException('This guild requires manual approval to join');
    }

    const existing = await this.memberRepo.findOne({
      where: { guild_id: guildId, user_id: userId },
    });
    if (existing) throw new ConflictException('Already a member');

    try {
      await this.memberRepo.manager.transaction(async (em) => {
        const current = await em.findOne(Guild, { where: { id: guildId }, lock: { mode: 'pessimistic_write' } });
        if (!current) throw new NotFoundException('Guild not found');
        if (current.member_count >= current.max_members) {
          throw new BadRequestException('Guild is full');
        }

        await em.insert(GuildMember, {
          guild_id: guildId,
          user_id: userId,
          role: GuildRole.MEMBER,
        });
        await em.increment(Guild, { id: guildId }, 'member_count', 1);
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        throw new ConflictException('Already a member');
      }
      throw err;
    }

    this.eventsGateway.broadcastGuildMemberJoined(guildId, userId);
    return { joined: true };
  }

  // ── Leave guild ───────────────────────────────────────────────────────────

  async leaveGuild(guildId: string, userId: string) {
    const member = await this.memberRepo.findOne({
      where: { guild_id: guildId, user_id: userId },
    });
    if (!member) throw new NotFoundException('Not a member');
    if (member.role === GuildRole.OWNER) {
      throw new BadRequestException('Owner cannot leave. Transfer ownership first or delete the guild.');
    }

    await this.memberRepo.manager.transaction(async (em) => {
      await em.delete(GuildMember, { id: member.id });
      await em.createQueryBuilder()
        .update(Guild)
        .set({ member_count: () => 'GREATEST(member_count - 1, 0)' })
        .where('id = :id', { id: guildId })
        .execute();
    });

    this.eventsGateway.broadcastGuildMemberLeft(guildId, userId);
    return { left: true };
  }

  // ── Kick member ───────────────────────────────────────────────────────────

  async kickMember(guildId: string, requesterId: string, targetUserId: string) {
    const requester = await this.requireRole(guildId, requesterId, [GuildRole.OWNER, GuildRole.MODERATOR]);
    const target = await this.memberRepo.findOne({
      where: { guild_id: guildId, user_id: targetUserId },
    });
    if (!target) throw new NotFoundException('Target user is not a member');
    if (target.role === GuildRole.OWNER) {
      throw new ForbiddenException('Cannot kick the owner');
    }
    if (target.role === GuildRole.MODERATOR && requester.role !== GuildRole.OWNER) {
      throw new ForbiddenException('Only the owner can kick moderators');
    }

    await this.memberRepo.manager.transaction(async (em) => {
      await em.delete(GuildMember, { id: target.id });
      await em.createQueryBuilder()
        .update(Guild)
        .set({ member_count: () => 'GREATEST(member_count - 1, 0)' })
        .where('id = :id', { id: guildId })
        .execute();
    });

    return { kicked: true };
  }

  // ── Change member role ────────────────────────────────────────────────────

  async changeMemberRole(guildId: string, requesterId: string, targetUserId: string, newRole: GuildRole) {
    await this.requireRole(guildId, requesterId, [GuildRole.OWNER]);

    if (requesterId === targetUserId) {
      throw new BadRequestException('Cannot change your own role');
    }

    const target = await this.memberRepo.findOne({
      where: { guild_id: guildId, user_id: targetUserId },
    });
    if (!target) throw new NotFoundException('Target user is not a member');

    if (newRole === GuildRole.OWNER) {
      throw new BadRequestException('Use transfer ownership instead');
    }

    target.role = newRole;
    await this.memberRepo.save(target);
    return { updated: true, role: newRole };
  }

  // ── Transfer ownership ────────────────────────────────────────────────────

  async transferOwnership(guildId: string, currentOwnerId: string, newOwnerId: string) {
    await this.requireRole(guildId, currentOwnerId, [GuildRole.OWNER]);

    const newOwner = await this.memberRepo.findOne({
      where: { guild_id: guildId, user_id: newOwnerId },
    });
    if (!newOwner) throw new NotFoundException('Target user is not a member');

    await this.memberRepo.manager.transaction(async (em) => {
      await em.update(GuildMember,
        { guild_id: guildId, user_id: currentOwnerId },
        { role: GuildRole.MEMBER },
      );
      await em.update(GuildMember,
        { guild_id: guildId, user_id: newOwnerId },
        { role: GuildRole.OWNER },
      );
      await em.update(Guild, { id: guildId }, { creator_id: newOwnerId });
    });

    return { transferred: true };
  }

  // ── Members list ──────────────────────────────────────────────────────────

  async getMembers(guildId: string, page = 1, limit = 30) {
    await this.requireGuild(guildId);
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const [data, total] = await this.memberRepo.findAndCount({
      where: { guild_id: guildId },
      relations: ['user'],
      order: { role: 'ASC', joined_at: 'ASC' },
      skip,
      take,
    });

    return { data, total, page, limit: take };
  }

  // ── Post message ──────────────────────────────────────────────────────────

  async postMessage(guildId: string, userId: string, userName: string, content: string) {
    await this.requireGuild(guildId);
    await this.requireMembership(guildId, userId);

    const sanitized = content?.replace(/<[^>]*>/g, '').trim();
    if (!sanitized || sanitized.length === 0) {
      throw new BadRequestException('Message content cannot be empty');
    }
    if (sanitized.length > 500) {
      throw new BadRequestException('Message content cannot exceed 500 characters');
    }

    const msg = this.messageRepo.create({
      guild_id: guildId,
      user_id: userId,
      user_name: userName,
      content: sanitized,
    });
    const saved = await this.messageRepo.save(msg);
    this.eventsGateway.broadcastGuildMessage(guildId, saved);
    return saved;
  }

  // ── Delete message ────────────────────────────────────────────────────────

  async deleteMessage(guildId: string, messageId: string, userId: string) {
    await this.requireGuild(guildId);
    const msg = await this.messageRepo.findOne({ where: { id: messageId, guild_id: guildId } });
    if (!msg) throw new NotFoundException('Message not found');

    if (msg.user_id !== userId) {
      await this.requireRole(guildId, userId, [GuildRole.OWNER, GuildRole.MODERATOR]);
    }

    await this.messageRepo.delete(messageId);
    return { deleted: true };
  }

  // ── Get messages ──────────────────────────────────────────────────────────

  async getMessages(guildId: string, limit = 50, before?: string) {
    await this.requireGuild(guildId);
    const take = Math.min(limit, 100);

    const qb = this.messageRepo
      .createQueryBuilder('m')
      .where('m.guild_id = :guildId', { guildId })
      .orderBy('m.created_at', 'DESC')
      .take(take);

    if (before) {
      qb.andWhere('m.created_at < :before', { before: new Date(before) });
    }

    return qb.getMany();
  }

  // ── Collective holdings ───────────────────────────────────────────────────

  async getHoldings(guildId: string) {
    await this.requireGuild(guildId);
    const holdings = await this.holdingRepo
      .createQueryBuilder('ph')
      .innerJoin('guild_members', 'gm', 'gm.user_id = ph.user_id')
      .innerJoinAndSelect('ph.artwork', 'a')
      .where('gm.guild_id = :guildId', { guildId })
      .select('ph.artwork_id', 'artwork_id')
      .addSelect('a.title', 'title')
      .addSelect('a.image_uri', 'image_uri')
      .addSelect('SUM(ph.share_balance)', 'total_shares')
      .addSelect('COUNT(DISTINCT ph.user_id)', 'holder_count')
      .groupBy('ph.artwork_id')
      .addGroupBy('a.title')
      .addGroupBy('a.image_uri')
      .orderBy('total_shares', 'DESC')
      .getRawMany();

    return holdings;
  }
}
