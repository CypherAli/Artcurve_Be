import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';
import { ChatService } from './chat.service';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { EscalationTicket } from './entities/escalation-ticket.entity';
import { GeminiService } from './gemini.service';
import { EscalationService } from './escalation.service';

const mockRepo = () => ({
  create: jest.fn((dto) => ({ id: 'uuid-1', ...dto })),
  save: jest.fn((e) => Promise.resolve({ id: 'uuid-1', ...e })),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  count: jest.fn().mockResolvedValue(0),
});

const mockRedis = () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  lrange: jest.fn().mockResolvedValue([]),
  pipeline: jest.fn().mockReturnValue({
    rpush: jest.fn().mockReturnThis(),
    ltrim: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  }),
});

describe('ChatService', () => {
  let service: ChatService;
  let sessionRepo: ReturnType<typeof mockRepo>;
  let msgRepo: ReturnType<typeof mockRepo>;
  let ticketRepo: ReturnType<typeof mockRepo>;
  let gemini: { chat: jest.Mock };
  let escalation: { escalate: jest.Mock };

  beforeEach(async () => {
    sessionRepo = mockRepo();
    msgRepo = mockRepo();
    ticketRepo = mockRepo();
    gemini = { chat: jest.fn().mockResolvedValue({ text: 'AI response', shouldEscalate: false }) };
    escalation = { escalate: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getRepositoryToken(ChatSession), useValue: sessionRepo },
        { provide: getRepositoryToken(ChatMessage), useValue: msgRepo },
        { provide: getRepositoryToken(EscalationTicket), useValue: ticketRepo },
        { provide: REDIS_CLIENT, useValue: mockRedis() },
        { provide: GeminiService, useValue: gemini },
        { provide: EscalationService, useValue: escalation },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  describe('getOrCreateSession', () => {
    it('should create new session if none exists', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      const result = await service.getOrCreateSession('user-1');
      expect(sessionRepo.create).toHaveBeenCalledWith({ user_id: 'user-1' });
      expect(result.user_id).toBe('user-1');
    });

    it('should return existing active session', async () => {
      const existing = { id: 'sess-1', user_id: 'user-1', status: 'active' };
      sessionRepo.findOne.mockResolvedValue(existing);
      const result = await service.getOrCreateSession('user-1');
      expect(result.id).toBe('sess-1');
    });
  });

  describe('sendMessage', () => {
    it('should save user and AI messages', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      sessionRepo.create.mockReturnValue({ id: 'sess-1', user_id: 'user-1' });
      sessionRepo.save.mockResolvedValue({ id: 'sess-1', user_id: 'user-1' });

      msgRepo.create.mockImplementation((dto) => ({ id: 'msg-' + dto.sender, ...dto }));
      msgRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.sendMessage('user-1', { content: 'Hello' });
      expect(result.userMsg.sender).toBe('user');
      expect(result.aiMsg.sender).toBe('ai');
      expect(result.aiMsg.content).toBe('AI response');
      expect(gemini.chat).toHaveBeenCalledWith('Hello', []);
    });

    it('should throw if session_id belongs to another user', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.sendMessage('user-1', { content: 'Hi', session_id: 'bad-sess' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('escalate', () => {
    it('should create ticket and trigger escalation', async () => {
      sessionRepo.findOne.mockResolvedValue({ id: 'sess-1', user_id: 'user-1', status: 'active' });
      ticketRepo.create.mockReturnValue({ id: 'ticket-1', session_id: 'sess-1', user_id: 'user-1' });
      ticketRepo.save.mockResolvedValue({ id: 'ticket-1', session_id: 'sess-1', user_id: 'user-1', summary: 'test', priority: 'medium' });

      const result = await service.escalate('user-1', 'sess-1', 'Need help');
      expect(result.id).toBe('ticket-1');
      expect(sessionRepo.save).toHaveBeenCalled();
    });

    it('should reject if already escalated', async () => {
      sessionRepo.findOne.mockResolvedValue({ id: 'sess-1', user_id: 'user-1', status: 'escalated' });
      await expect(
        service.escalate('user-1', 'sess-1', 'reason'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('closeSession', () => {
    it('should close session', async () => {
      sessionRepo.findOne.mockResolvedValue({ id: 'sess-1', user_id: 'user-1', status: 'active' });
      await service.closeSession('sess-1', 'user-1');
      expect(sessionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'closed' }),
      );
    });

    it('should throw if not found', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      await expect(service.closeSession('bad', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
