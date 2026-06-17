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
      level: 1,
      max_members: dto.max_members ?? 30,
      acceptance: dto.acceptance ?? 'auto',
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

  // ── List all guilds (kèm khối lượng giao dịch 7 ngày của thành viên) ───────

  async listGuilds() {
    // weekly_volume_eth = tổng eth_amount của giao dịch các thành viên trong 7 ngày.
    // t.user_id = gm.user_id nên mỗi giao dịch chỉ được cộng đúng 1 lần / guild.
    const { entities, raw } = await this.guildRepo
      .createQueryBuilder('g')
      .leftJoin('guild_members', 'gm', 'gm.guild_id = g.id')
      .leftJoin('transactions', 't',
        "t.user_id = gm.user_id AND t.timestamp > NOW() - INTERVAL '7 days'")
      .addSelect('COALESCE(SUM(CAST(t.eth_amount AS DECIMAL(38,18))), 0)', 'weekly_volume_eth')
      .groupBy('g.id')
      .orderBy('g.member_count', 'DESC')
      .getRawAndEntities();

    return entities.map((g, i) => ({
      ...g,
      weekly_volume_eth: Number(raw[i]?.weekly_volume_eth ?? 0),
    }));
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

    // Insert member + increment count trong CÙNG transaction → không bao giờ lệch
    // (kể cả khi process crash giữa chừng). Unique (guild_id, user_id) chặn double-join.
    try {
      await this.memberRepo.manager.transaction(async (em) => {
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

    // Remove + decrement atomic; GREATEST(...,0) tránh count âm nếu có lệch dữ liệu cũ
    await this.memberRepo.manager.transaction(async (em) => {
      await em.delete(GuildMember, { id: member.id });
      await em.createQueryBuilder()
        .update(Guild)
        .set({ member_count: () => 'GREATEST(member_count - 1, 0)' })
        .where('id = :id', { id: guildId })
        .execute();
    });

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
