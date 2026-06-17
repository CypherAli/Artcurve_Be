import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { GeminiService } from './gemini.service';
import { ChatToolsService } from './chat-tools.service';

describe('GeminiService', () => {
  let service: GeminiService;
  let httpService: { post: jest.Mock };
  let tools: { declarations: unknown[]; execute: jest.Mock };

  beforeEach(async () => {
    httpService = { post: jest.fn() };
    tools = { declarations: [], execute: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        GeminiService,
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: { get: (key: string, def?: string) => key === 'GEMINI_API_KEY' ? 'test-key' : def ?? '' },
        },
        { provide: ChatToolsService, useValue: tools },
      ],
    }).compile();

    service = module.get(GeminiService);
  });

  it('should return AI response', async () => {
    httpService.post.mockReturnValue(of({
      data: {
        candidates: [{ content: { parts: [{ text: 'Hello! How can I help?' }] } }],
      },
    }));

    const result = await service.chat('Hi', []);
    expect(result.text).toBe('Hello! How can I help?');
    expect(result.shouldEscalate).toBe(false);
    expect(httpService.post).toHaveBeenCalledTimes(1);
  });

  it('should detect escalation flag', async () => {
    httpService.post.mockReturnValue(of({
      data: {
        candidates: [{ content: { parts: [{ text: 'I cannot help with that. [ESCALATE]' }] } }],
      },
    }));

    const result = await service.chat('I have a billing issue', []);
    expect(result.text).toBe('I cannot help with that.');
    expect(result.shouldEscalate).toBe(true);
  });

  it('should handle API errors gracefully', async () => {
    httpService.post.mockReturnValue(throwError(() => new Error('Network error')));

    const result = await service.chat('test', []);
    expect(result.shouldEscalate).toBe(true);
    expect(result.text).toContain('error');
  });

  it('should return fallback when no API key', async () => {
    const module = await Test.createTestingModule({
      providers: [
        GeminiService,
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: { get: () => '' } },
        { provide: ChatToolsService, useValue: tools },
      ],
    }).compile();

    const svc = module.get(GeminiService);
    const result = await svc.chat('test', []);
    expect(result.shouldEscalate).toBe(true);
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('should pass conversation history', async () => {
    httpService.post.mockReturnValue(of({
      data: { candidates: [{ content: { parts: [{ text: 'response' }] } }] },
    }));

    await service.chat('new msg', [
      { sender: 'user', content: 'hello' },
      { sender: 'ai', content: 'hi there' },
    ]);

    const callBody = httpService.post.mock.calls[0][1];
    expect(callBody.contents).toHaveLength(3);
    expect(callBody.contents[0].role).toBe('user');
    expect(callBody.contents[1].role).toBe('model');
    expect(callBody.contents[2].role).toBe('user');
  });

  it('should run the function-calling loop: tool call → execute → final answer', async () => {
    // Lượt 1: model gọi tool. Lượt 2: model trả lời bằng text dựa trên kết quả tool.
    httpService.post
      .mockReturnValueOnce(of({
        data: { candidates: [{ content: { parts: [{ functionCall: { name: 'search_artworks', args: { query: 'Pale' } } }] } }] },
      }))
      .mockReturnValueOnce(of({
        data: { candidates: [{ content: { parts: [{ text: 'Pale Architecture đang ở 1.82 ETH.' }] } }] },
      }));
    tools.execute.mockResolvedValue({ count: 1, results: [{ title: 'Pale Architecture', price_eth: '1.82' }] });

    const result = await service.chat('giá Pale bao nhiêu?', [], { userId: 'u1' });

    expect(tools.execute).toHaveBeenCalledWith('search_artworks', { query: 'Pale' }, { userId: 'u1' });
    expect(result.text).toContain('1.82');
    expect(httpService.post).toHaveBeenCalledTimes(2);

    // Lượt 2 phải kèm functionResponse trong contents
    const secondBody = httpService.post.mock.calls[1][1];
    const hasFnResponse = secondBody.contents.some(
      (c: any) => c.parts.some((p: any) => p.functionResponse?.name === 'search_artworks'),
    );
    expect(hasFnResponse).toBe(true);
  });

  it('account tool nhận đúng userId của phiên (không lấy từ model)', async () => {
    httpService.post
      .mockReturnValueOnce(of({
        data: { candidates: [{ content: { parts: [{ functionCall: { name: 'get_my_portfolio', args: {} } }] } }] },
      }))
      .mockReturnValueOnce(of({
        data: { candidates: [{ content: { parts: [{ text: 'Portfolio của bạn 2.5 ETH.' }] } }] },
      }));
    tools.execute.mockResolvedValue({ total_value_eth: '2.50000000' });

    await service.chat('portfolio của tôi?', [], { userId: 'real-user-42' });
    expect(tools.execute).toHaveBeenCalledWith('get_my_portfolio', {}, { userId: 'real-user-42' });
  });
});
