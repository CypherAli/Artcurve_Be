import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface GeminiResponse {
  text: string;
  shouldEscalate: boolean;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

const SYSTEM_PROMPT = `You are ArtCurve Support — a friendly support agent for ArtCurve, a Web3 art trading platform built on Base blockchain. You are NOT an AI assistant — you are "ArtCurve Support". Never refer to yourself as AI, bot, language model, or assistant. Speak as a knowledgeable support team member.

Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

Your knowledge covers:
- Bonding curves: ArtCurve uses bonding curves (linear, quadratic, exponential) for dynamic art token pricing. Price increases as more tokens are bought.
- Art tokens: Each artwork has its own ERC-20 token. Users buy/sell tokens to trade art.
- Graduation: When an artwork reaches its target market cap, it "graduates" to a DEX (decentralized exchange).
- Portfolio: Users can track their holdings, P&L, and trading history.
- SIWE Authentication: Users sign in using their Ethereum wallet (Sign-In with Ethereum). Also supports Google and GitHub OAuth login.
- Social features: Follow artists, like artworks, leave reviews.
- Live streaming: Artists can live stream their creative process.

Guidelines:
- Be concise, friendly, and helpful. Use a warm, human tone.
- Answer in the same language the user writes in.
- You can answer general questions (date, greetings, etc.) naturally like a human support agent would.
- If you cannot answer confidently (account-specific issues, billing disputes, bug reports, or technical problems requiring investigation), respond with your best attempt BUT include the exact phrase "[ESCALATE]" at the end of your message.
- Never fabricate transaction details, wallet addresses, or financial data.
- For security-related questions (private keys, seed phrases), always warn users to never share them.`;

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('GEMINI_API_KEY', '');
    this.endpoint =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  }

  async chat(
    userMessage: string,
    history: { sender: string; content: string }[],
  ): Promise<GeminiResponse> {
    if (!this.apiKey) {
      this.logger.warn('GEMINI_API_KEY not configured — returning fallback response');
      return {
        text: 'AI Assistant is not configured yet. Please contact support for help.',
        shouldEscalate: true,
      };
    }

    const contents: GeminiContent[] = [];

    const recentHistory = history.slice(-20);
    for (const msg of recentHistory) {
      contents.push({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      });
    }

    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    try {
      const response = await firstValueFrom(
        this.http.post(
          `${this.endpoint}?key=${this.apiKey}`,
          {
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
            },
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30_000,
          },
        ),
      );

      const text =
        response.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      const shouldEscalate = text.includes('[ESCALATE]');
      const cleanText = text.replace(/\[ESCALATE\]/g, '').trim();

      this.logger.log(
        `Gemini response: ${cleanText.slice(0, 80)}... escalate=${shouldEscalate}`,
      );

      return { text: cleanText, shouldEscalate };
    } catch (err: any) {
      this.logger.error(`Gemini API error: ${err.message}`);
      return {
        text: 'Sorry, I encountered an error processing your request. Please try again or contact support.',
        shouldEscalate: true,
      };
    }
  }
}
