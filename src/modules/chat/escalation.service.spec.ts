import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { EscalationService } from './escalation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EscalationTicket } from './entities/escalation-ticket.entity';

describe('EscalationService', () => {
  let service: EscalationService;
  let notifSvc: { create: jest.Mock };
  let httpService: { post: jest.Mock };

  const mockTicket: EscalationTicket = {
    id: 'ticket-1',
    session_id: 'sess-1',
    user_id: 'user-1',
    status: 'open',
    priority: 'medium',
    summary: 'User needs help',
    created_at: new Date(),
    resolved_at: null,
  };

  const mockTranscript = [
    { sender: 'user', content: 'Help me', created_at: new Date() },
    { sender: 'ai', content: 'I cannot help with that', created_at: new Date() },
  ];

  beforeEach(async () => {
    notifSvc = { create: jest.fn().mockResolvedValue({}) };
    httpService = { post: jest.fn().mockReturnValue(of({ data: {} })) };

    const module = await Test.createTestingModule({
      providers: [
        EscalationService,
        { provide: NotificationsService, useValue: notifSvc },
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: any) => {
              const map: Record<string, string> = {
                SMTP_HOST: '',
                TELEGRAM_BOT_TOKEN: 'bot-token',
                TELEGRAM_ESCALATION_CHAT_ID: '12345',
              };
              return map[key] ?? def ?? '';
            },
          },
        },
      ],
    }).compile();

    service = module.get(EscalationService);
  });

  it('should send in-app notification', async () => {
    await service.escalate(mockTicket, mockTranscript);
    expect(notifSvc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        title: 'Support ticket created',
      }),
    );
  });

  it('should send Telegram message', async () => {
    await service.escalate(mockTicket, mockTranscript);
    expect(httpService.post).toHaveBeenCalledWith(
      expect.stringContaining('api.telegram.org/botbot-token/sendMessage'),
      expect.objectContaining({ chat_id: '12345' }),
    );
  });

  it('should not fail if channels error', async () => {
    notifSvc.create.mockRejectedValue(new Error('DB error'));
    httpService.post.mockReturnValue(of({ data: {} }));
    await expect(service.escalate(mockTicket, mockTranscript)).resolves.not.toThrow();
  });
});
