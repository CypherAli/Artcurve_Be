import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { EscalationTicket } from './entities/escalation-ticket.entity';
import { GeminiService } from './gemini.service';
import { EscalationService } from './escalation.service';
import { SendMessageDto } from './dto/send-message.dto';

const SESSION_TTL = 86400; // 24h
const MSG_CACHE_LIMIT = 100;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepo: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly msgRepo: Repository<ChatMessage>,
    @InjectRepository(EscalationTicket)
    private readonly ticketRepo: Repository<EscalationTicket>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
    private readonly gemini: GeminiService,
    private readonly escalationSvc: EscalationService,
  ) {}

  async getOrCreateSession(userId: string): Promise<ChatSession> {
    const cacheKey = `chat:session:${userId}`;
    const cachedId = await this.redis.get(cacheKey).catch(() => null);

    if (cachedId) {
      const session = await this.sessionRepo.findOne({
        where: { id: cachedId, user_id: userId, status: 'active' },
      });
      if (session) return session;
    }

    const existing = await this.sessionRepo.findOne({
      where: { user_id: userId, status: 'active' },
      order: { created_at: 'DESC' },
    });
    if (existing) {
      await this.redis.set(cacheKey, existing.id, 'EX', SESSION_TTL).catch(() => {});
      return existing;
    }

    const session = this.sessionRepo.create({ user_id: userId });
    const saved = await this.sessionRepo.save(session);
    await this.redis.set(cacheKey, saved.id, 'EX', SESSION_TTL).catch(() => {});
    return saved;
  }

  async sendMessage(
    userId: string,
    dto: SendMessageDto,
  ): Promise<{ userMsg: ChatMessage; aiMsg: ChatMessage; shouldEscalate: boolean }> {
    let session: ChatSession;
    if (dto.session_id) {
      const s = await this.sessionRepo.findOne({
        where: { id: dto.session_id, user_id: userId },
      });
      if (!s) throw new NotFoundException('Session not found');
      session = s;
    } else {
      session = await this.getOrCreateSession(userId);
    }

    const userMsg = this.msgRepo.create({
      session_id: session.id,
      sender: 'user',
      content: dto.content,
    });
    await this.msgRepo.save(userMsg);
    await this.cacheMessage(session.id, userMsg);

    const history = await this.getRecentMessages(session.id);

    const aiResponse = await this.gemini.chat(dto.content, history);

    const aiMsg = this.msgRepo.create({
      session_id: session.id,
      sender: 'ai',
      content: aiResponse.text,
      metadata: { shouldEscalate: aiResponse.shouldEscalate },
    });
    await this.msgRepo.save(aiMsg);
    await this.cacheMessage(session.id, aiMsg);

    return { userMsg, aiMsg, shouldEscalate: aiResponse.shouldEscalate };
  }

  async getHistory(
    sessionId: string,
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<ChatMessage[]> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, user_id: userId },
    });
    if (!session) throw new NotFoundException('Session not found');

    if (offset === 0 && limit <= MSG_CACHE_LIMIT) {
      const cached = await this.getCachedMessages(sessionId);
      if (cached.length > 0) return cached.slice(0, limit);
    }

    return this.msgRepo.find({
      where: { session_id: sessionId },
      order: { created_at: 'ASC' },
      take: limit,
      skip: offset,
    });
  }

  async getSessions(userId: string): Promise<ChatSession[]> {
    return this.sessionRepo.find({
      where: { user_id: userId },
      order: { updated_at: 'DESC' },
      take: 20,
    });
  }

  async escalate(
    userId: string,
    sessionId: string,
    reason: string,
  ): Promise<EscalationTicket> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, user_id: userId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status === 'escalated')
      throw new ForbiddenException('Session already escalated');

    session.status = 'escalated';
    session.escalation_reason = reason;
    await this.sessionRepo.save(session);

    const messages = await this.msgRepo.find({
      where: { session_id: sessionId },
      order: { created_at: 'ASC' },
      take: 30,
    });

    const summaryParts = messages.slice(-5).map(
      (m) => `[${m.sender}] ${m.content.slice(0, 100)}`,
    );
    const summary = `${reason}\n\nRecent messages:\n${summaryParts.join('\n')}`;

    const ticket = this.ticketRepo.create({
      session_id: sessionId,
      user_id: userId,
      summary,
      priority: 'medium',
    });
    const saved = await this.ticketRepo.save(ticket);

    const transcript = messages.map((m) => ({
      sender: m.sender,
      content: m.content,
      created_at: m.created_at,
    }));
    this.escalationSvc.escalate(saved, transcript).catch((err) => {
      this.logger.error(`Escalation dispatch failed: ${err.message}`);
    });

    return saved;
  }

  async closeSession(sessionId: string, userId: string): Promise<void> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, user_id: userId },
    });
    if (!session) throw new NotFoundException('Session not found');

    session.status = 'closed';
    await this.sessionRepo.save(session);
    await this.redis.del(`chat:session:${userId}`).catch(() => {});
    await this.redis.del(`chat:messages:${sessionId}`).catch(() => {});
  }

  private async cacheMessage(sessionId: string, msg: ChatMessage): Promise<void> {
    const key = `chat:messages:${sessionId}`;
    const data = JSON.stringify({
      id: msg.id,
      sender: msg.sender,
      content: msg.content,
      metadata: msg.metadata,
      created_at: msg.created_at,
    });
    await this.redis
      .pipeline()
      .rpush(key, data)
      .ltrim(key, -MSG_CACHE_LIMIT, -1)
      .expire(key, SESSION_TTL)
      .exec()
      .catch(() => {});
  }

  private async getCachedMessages(sessionId: string): Promise<ChatMessage[]> {
    const key = `chat:messages:${sessionId}`;
    const items = await this.redis.lrange(key, 0, -1).catch(() => [] as string[]);
    return items.map((raw) => JSON.parse(raw));
  }

  private async getRecentMessages(
    sessionId: string,
  ): Promise<{ sender: string; content: string }[]> {
    const cached = await this.getCachedMessages(sessionId);
    if (cached.length > 0) {
      return cached.map((m) => ({ sender: m.sender, content: m.content }));
    }

    const msgs = await this.msgRepo.find({
      where: { session_id: sessionId },
      order: { created_at: 'DESC' },
      take: 20,
    });
    return msgs.reverse().map((m) => ({ sender: m.sender, content: m.content }));
  }
}
