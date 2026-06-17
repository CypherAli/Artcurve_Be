import { Injectable, Logger } from '@nestjs/common';
import { ArtworksService } from '../artworks/artworks.service';
import { VaultService } from '../vault/vault.service';
import { GuildService } from '../guild/guild.service';

// ─────────────────────────────────────────────────────────────────
//  ChatToolsService — "function calling" tools cho chatbot.
//
//  Mỗi tool là READ-ONLY và nối vào service nghiệp vụ đã có. Gemini tự
//  quyết định gọi tool nào; backend chạy thật → trả số liệu real-time.
//
//  BẢO MẬT: tool account (portfolio/holdings) CHỈ dùng userId của phiên
//  đăng nhập (ctx.userId) — KHÔNG nhận userId từ tham số model sinh ra.
// ─────────────────────────────────────────────────────────────────

export interface ToolContext {
  userId?: string | null
}

// Gemini functionDeclarations (OpenAPI subset, Type viết HOA).
export const TOOL_DECLARATIONS = [
  {
    name: 'search_artworks',
    description: 'Tìm artwork đang ACTIVE theo từ khóa (tên/ticker). Trả về giá hiện tại, supply, trạng thái. Dùng khi user hỏi về một tác phẩm cụ thể hoặc giá của nó.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Từ khóa tên hoặc ticker artwork' },
        limit: { type: 'INTEGER', description: 'Số kết quả tối đa (mặc định 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_marketplace',
    description: 'Lấy danh sách artwork ACTIVE trên marketplace. Dùng khi user hỏi "có gì hot", "mới nhất", "đang trending", "giá cao nhất".',
    parameters: {
      type: 'OBJECT',
      properties: {
        sortBy: { type: 'STRING', description: "Một trong: 'trending' | 'price' | 'created_at' | 'view_count'" },
        limit:  { type: 'INTEGER', description: 'Số kết quả (mặc định 8)' },
      },
    },
  },
  {
    name: 'get_platform_stats',
    description: 'Thống kê tổng quan sàn ArtCurve: số artwork active, tổng volume ETH, số collector.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_my_portfolio',
    description: 'Tổng quan portfolio của CHÍNH user đang đăng nhập: tổng giá trị, P&L chưa/đã thực hiện, số vị thế. Dùng khi user hỏi "portfolio của tôi", "tôi lãi/lỗ bao nhiêu".',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_my_holdings',
    description: 'Danh sách các artwork user đang nắm giữ kèm số dư, giá, P&L từng vị thế.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_guilds',
    description: 'Danh sách guild (hội sưu tầm) để gợi ý gia nhập. Dùng khi user hỏi về guild.',
    parameters: {
      type: 'OBJECT',
      properties: { limit: { type: 'INTEGER', description: 'Số guild (mặc định 8)' } },
    },
  },
] as const

type ToolArgs = Record<string, unknown>

@Injectable()
export class ChatToolsService {
  private readonly logger = new Logger(ChatToolsService.name)

  constructor(
    private readonly artworks: ArtworksService,
    private readonly vault: VaultService,
    private readonly guild: GuildService,
  ) {}

  get declarations() {
    return TOOL_DECLARATIONS
  }

  /** Chạy 1 tool. Luôn trả object JSON-safe (không throw — lỗi gói vào { error }). */
  async execute(name: string, args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    try {
      switch (name) {
        case 'search_artworks':   return await this.searchArtworks(args)
        case 'get_marketplace':   return await this.getMarketplace(args)
        case 'get_platform_stats':return { ...(await this.artworks.getPlatformStats()) }
        case 'get_my_portfolio':  return await this.myPortfolio(ctx)
        case 'get_my_holdings':   return await this.myHoldings(ctx)
        case 'list_guilds':       return await this.listGuilds(args)
        default:                  return { error: `unknown_tool:${name}` }
      }
    } catch (err) {
      this.logger.warn(`Tool ${name} failed: ${(err as Error).message}`)
      return { error: 'tool_failed', message: (err as Error).message }
    }
  }

  // ── implementations (map gọn để tiết kiệm token) ──────────────────
  private async searchArtworks(args: ToolArgs) {
    const query = String(args.query ?? '').trim()
    const limit = Math.min(Number(args.limit) || 5, 20)
    if (!query) return { error: 'missing_query' }
    const res = await this.artworks.searchArtworks({ q: query, limit } as any)
    return {
      count: res.total,
      results: res.data.map((a: any) => ({
        title: a.title, ticker: a.ticker, status: a.status,
        price_eth: a.current_price, supply: a.current_supply,
      })),
    }
  }

  private async getMarketplace(args: ToolArgs) {
    const allowed = ['trending', 'price', 'created_at', 'view_count']
    const sortBy = allowed.includes(String(args.sortBy)) ? String(args.sortBy) : 'trending'
    const limit = Math.min(Number(args.limit) || 8, 20)
    const res = await this.artworks.getMarketplace(sortBy as any, 1, limit)
    return {
      sortBy,
      results: res.data.map((a: any) => ({
        title: a.title, ticker: a.ticker, price_eth: a.current_price, views: a.view_count,
      })),
    }
  }

  private async myPortfolio(ctx: ToolContext): Promise<Record<string, unknown>> {
    if (!ctx.userId) return { error: 'not_signed_in' }
    return { ...(await this.vault.getOverview(ctx.userId)) }
  }

  private async myHoldings(ctx: ToolContext) {
    if (!ctx.userId) return { error: 'not_signed_in' }
    const rows = await this.vault.getHoldings(ctx.userId)
    return {
      count: rows.length,
      holdings: rows.map((h) => ({
        title: h.title, ticker: h.ticker, shares: h.share_balance,
        price_eth: h.current_price, value_eth: h.value_eth, pnl_eth: h.pnl_eth, pnl_pct: h.pnl_pct,
      })),
    }
  }

  private async listGuilds(args: ToolArgs) {
    const limit = Math.min(Number(args.limit) || 8, 20)
    const rows = await this.guild.listGuilds()
    return {
      results: rows.slice(0, limit).map((g: any) => ({
        name: g.name, focus: g.focus, members: g.member_count, description: g.description ?? undefined,
      })),
    }
  }
}
