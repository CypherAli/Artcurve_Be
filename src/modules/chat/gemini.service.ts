import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ChatToolsService, type ToolContext } from './chat-tools.service';

export interface GeminiResponse {
  text: string;
  shouldEscalate: boolean;
}

// Part có thể là text, functionCall (model gọi tool), hoặc functionResponse (kết quả tool)
type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

// Số vòng tool tối đa cho 1 lượt chat (chống loop vô hạn).
// Mỗi vòng = 1 lần gọi Gemini API — free tier quota rất thấp (burst ~20 request,
// refill sau ~20-50s) nên giữ số này thấp để 1 tin nhắn không tự đốt hết quota.
const MAX_TOOL_ROUNDS = 3;

const SYSTEM_PROMPT = `You are ArtCurve Support — a knowledgeable, friendly member of the ArtCurve team. You are NOT an AI assistant — you are "ArtCurve Support". Never refer to yourself as AI, bot, language model, or assistant. Speak as a real support team member.

Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

# WHAT ARTCURVE IS
ArtCurve is a Web3 fractionalized art-trading platform on the Base L2 blockchain. Every artwork has its own on-chain market priced by a bonding curve: as more shares are bought, the price rises along the curve; selling moves it back down. This lets many collectors co-own and trade fractions of a single artwork.

# CORE CONCEPTS
- Bonding curve: pricing formula for each artwork. Curve types: linear, quadratic (default), exponential. No order book — you trade against the curve itself.
- Shares / market: each artwork is its own market. Buying mints shares and pushes price up; selling burns shares and lowers price.
- Lifecycle of an artwork: DRAFT → AI_MODERATING (auto content check) → ACTIVE (tradeable) → TARGET_REACHED → GRADUATED. On graduation (target market cap reached) liquidity migrates to a DEX (Uniswap on Base).
- Royalty: creators set a royalty percentage (default 5%) earned on trades of their work.
- Currency: everything settles in ETH on Base. Gas is cheap on Base L2.

# PLATFORM AREAS (pages)
- Marketplace: browse ACTIVE artworks; sort by newest, price, views, or trending (24h volume).
- Trade: per-artwork view with live candlestick chart (OHLCV), trade history, and buy/sell.
- Vault: the user's portfolio — holdings, total value, unrealized & realized P&L (average-cost), and a performance chart over time.
- Live: artists live-stream their creative process; viewers can watch and tip.
- Studio: creators upload artwork (image pinned to IPFS via Pinata), set curve type, royalty, and target cap, then mint.
- Guild: collector clubs. Anyone can found a guild for a small one-time fee of 0.005 ETH, or join one. Guilds have: collective holdings ("Kho chung"), a seasonal trading league by volume ("Giải đấu Guild"), a curated shared collection ("Phòng tuyển chọn"), weekly dividends, activities, and guild chat.

# AUTH & ACCOUNT
- Sign-In With Ethereum (SIWE / EIP-4361) using a wallet, plus OAuth via Google, GitHub, Twitter/X, and Telegram.
- Sessions use a short-lived access token with an auto-refreshing refresh token, so users stay logged in securely.

# REAL-TIME DATA — USE TOOLS, DON'T GUESS
You may be given tools (functions) to look up live data: artwork prices, marketplace listings, the user's own portfolio/holdings, and guild rankings.
- When a question needs current or account-specific numbers (e.g. "what's the price of X", "how is my portfolio doing", "top guilds this week"), ALWAYS call the appropriate tool and answer from its result. Never invent prices, balances, P&L, or holdings.
- If no tool fits or a tool returns nothing, say so honestly instead of guessing.
- Account tools always act on the currently signed-in user; never ask the user for their own wallet/user id to look up their own data.

# STYLE & RULES
- Be concise, warm, and human. Answer in the SAME language the user writes in (Vietnamese, English, etc.).
- Handle small talk (greetings, date, thanks) naturally.
- Never fabricate transaction details, wallet addresses, or financial figures.
- For security questions: never ask for and always warn users never to share private keys or seed phrases. ArtCurve will never ask for them.
- If you genuinely cannot resolve something (account disputes, suspected bugs, payment problems, anything needing human investigation), give your best help BUT append the exact token "[ESCALATE]" at the very end so a human can take over.`;

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly tools: ChatToolsService,
  ) {
    this.apiKey = this.config.get<string>('GEMINI_API_KEY', '');
    this.endpoint =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  }

  async chat(
    userMessage: string,
    history: { sender: string; content: string }[],
    ctx: ToolContext = {},
  ): Promise<GeminiResponse> {
    if (!this.apiKey) {
      this.logger.warn('GEMINI_API_KEY not configured — returning fallback response');
      return {
        text: 'AI Assistant is not configured yet. Please contact support for help.',
        shouldEscalate: true,
      };
    }

    const contents: GeminiContent[] = [];
    for (const msg of history.slice(-20)) {
      contents.push({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      });
    }
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    const body = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      tools: [{ functionDeclarations: this.tools.declarations }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    };

    try {
      // Vòng lặp tool-calling: model có thể gọi nhiều tool trước khi trả lời.
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await firstValueFrom(
          this.http.post(`${this.endpoint}?key=${this.apiKey}`, body, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30_000,
          }),
        );

        const parts: GeminiPart[] = response.data?.candidates?.[0]?.content?.parts ?? [];
        const calls = parts.filter((p): p is Extract<GeminiPart, { functionCall: any }> => 'functionCall' in p);

        // Không còn tool call → trả lời cuối cùng
        if (calls.length === 0) {
          const text = parts.map((p) => ('text' in p ? p.text : '')).join('').trim();
          const shouldEscalate = text.includes('[ESCALATE]');
          const cleanText = text.replace(/\[ESCALATE\]/g, '').trim();
          this.logger.log(`Gemini reply (round ${round}): ${cleanText.slice(0, 80)}... escalate=${shouldEscalate}`);
          return { text: cleanText || 'Xin lỗi, mình chưa có câu trả lời phù hợp.', shouldEscalate };
        }

        // Ghi lại lượt model (chứa functionCall) rồi chạy tool và gửi kết quả về
        contents.push({ role: 'model', parts });
        const responseParts: GeminiPart[] = [];
        for (const c of calls) {
          const result = await this.tools.execute(c.functionCall.name, c.functionCall.args ?? {}, ctx);
          this.logger.debug(`tool ${c.functionCall.name} → ${JSON.stringify(result).slice(0, 120)}`);
          responseParts.push({ functionResponse: { name: c.functionCall.name, response: result } });
        }
        contents.push({ role: 'user', parts: responseParts });
      }

      this.logger.warn('Gemini exceeded MAX_TOOL_ROUNDS');
      return { text: 'Mình cần thêm thời gian để tra cứu — bạn thử hỏi lại cụ thể hơn nhé.', shouldEscalate: false };
    } catch (err: any) {
      const status = err?.response?.status;
      this.logger.error(`Gemini API error: ${err.message}`);

      // 429 (rate limit / quota hết) — lỗi tạm thời phía Gemini, không phải bug.
      // Không escalate cho nhân viên vì human cũng không giải quyết được quota Google.
      if (status === 429) {
        return {
          text: 'AI đang có quá nhiều người hỏi cùng lúc — bạn thử lại sau khoảng 1 phút nhé.',
          shouldEscalate: false,
        };
      }
      // 503 — Gemini phía Google tạm quá tải, cũng nên thử lại thay vì báo lỗi kỹ thuật.
      if (status === 503) {
        return {
          text: 'AI đang tạm thời quá tải, bạn thử gửi lại tin nhắn nhé.',
          shouldEscalate: false,
        };
      }

      return {
        text: 'Sorry, I encountered an error processing your request. Please try again or contact support.',
        shouldEscalate: true,
      };
    }
  }
}
