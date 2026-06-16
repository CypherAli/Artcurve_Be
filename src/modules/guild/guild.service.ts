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

// Random pastel color for guild avatar
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
  ) {}

  // ── Create guild ──────────────────────────────────────────────────────────

  async createGuild(userId: string, userName: string, dto: CreateGuildDto) {
    const guild = this.guildRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      focus: dto.focus,
      creator_id: userId,
      member_count: 1,
      avatar_color: randomColor(),
    });
    const saved = await this.guildRepo.save(guild);

    // Add creator as owner
    const member = this.memberRepo.create({
      guild_id: saved.id,
      user_id: userId,
      role: GuildRole.OWNER,
    });
    await this.memberRepo.save(member);

    return saved;
  }

  // ── List all guilds ───────────────────────────────────────────────────────

  async listGuilds() {
    return this.guildRepo.find({ order: { member_count: 'DESC' } });
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
    const guild = await this.guildRepo.findOne({ where: { id: guildId } });
    if (!guild) throw new NotFoundException('Guild not found');
    return guild;
  }

  // ── Join guild ────────────────────────────────────────────────────────────

  async joinGuild(guildId: string, userId: string) {
    await this.getGuild(guildId); // ensure exists

    const existing = await this.memberRepo.findOne({
      where: { guild_id: guildId, user_id: userId },
    });
    if (existing) throw new ConflictException('Already a member');

    const member = this.memberRepo.create({
      guild_id: guildId,
      user_id: userId,
      role: GuildRole.MEMBER,
    });

    // Atomic guard chống race: nếu 2 request đồng thời, unique constraint
    // (guild_id, user_id) sẽ chặn bản ghi thứ 2 → chỉ increment khi insert thành công.
    try {
      await this.memberRepo.save(member);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        throw new ConflictException('Already a member');
      }
      throw err;
    }
    await this.guildRepo.increment({ id: guildId }, 'member_count', 1);

    return { joined: true };
  }

  // ── Leave guild ───────────────────────────────────────────────────────────

  async leaveGuild(guildId: string, userId: string) {
    const member = await this.memberRepo.findOne({
      where: { guild_id: guildId, user_id: userId },
    });
    if (!member) throw new NotFoundException('Not a member');
    if (member.role === GuildRole.OWNER) {
      throw new BadRequestException('Owner cannot leave the guild');
    }

    await this.memberRepo.remove(member);
    await this.guildRepo.decrement({ id: guildId }, 'member_count', 1);

    return { left: true };
  }

  // ── Members list ──────────────────────────────────────────────────────────

  async getMembers(guildId: string) {
    return this.memberRepo.find({
      where: { guild_id: guildId },
      relations: ['user'],
      order: { joined_at: 'ASC' },
    });
  }

  // ── Post message ──────────────────────────────────────────────────────────

  async postMessage(
    guildId: string,
    userId: string,
    userName: string,
    content: string,
  ) {
    await this.getGuild(guildId); // ensure exists

    // Chỉ thành viên của guild mới được post — chống user ngoài spam vào guild
    const membership = await this.memberRepo.findOne({
      where: { guild_id: guildId, user_id: userId },
    });
    if (!membership) {
      throw new ForbiddenException('Bạn phải là thành viên của guild để gửi tin nhắn');
    }

    const msg = this.messageRepo.create({
      guild_id: guildId,
      user_id: userId,
      user_name: userName,
      content,
    });
    return this.messageRepo.save(msg);
  }

  // ── Get messages ──────────────────────────────────────────────────────────

  async getMessages(guildId: string, limit = 50) {
    return this.messageRepo.find({
      where: { guild_id: guildId },
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  // ── Collective holdings ───────────────────────────────────────────────────

  async getHoldings(guildId: string) {
    // Aggregate portfolio_holdings for all guild members
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
