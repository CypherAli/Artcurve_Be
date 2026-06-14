import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { GeminiService } from './gemini.service';

describe('GeminiService', () => {
  let service: GeminiService;
  let httpService: { post: jest.Mock };

  beforeEach(async () => {
    httpService = { post: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        GeminiService,
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: { get: (key: string, def?: string) => key === 'GEMINI_API_KEY' ? 'test-key' : def ?? '' },
        },
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
});
