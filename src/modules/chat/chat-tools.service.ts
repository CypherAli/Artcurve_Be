import { Injectable, Logger } from '@nestjs/common';
import { ArtworksService } from '../artworks/artworks.service';
import { VaultService } from '../vault/vault.service';
import { GuildService } from '../guild/guild.service';
import { TradesService } from '../trades/trades.service';
import { SocialService } from '../social/social.service';
import { LiveService } from '../live/live.service';
import { UsersService } from '../users/users.service';
import { PortfolioService } from '../portfolio/portfolio.service';

// ─────────────────────────────────────────────────────────────────
//  ChatToolsService — bộ "function calling" tools cho chatbot ArtCurve.
//  Tất cả READ-ONLY, nối vào service nghiệp vụ → trả số liệu real-time.
//  Account tool (my_*) CHỈ dùng ctx.userId của phiên đăng nhập.
// ─────────────────────────────────────────────────────────────────

export interface ToolContext { userId?: string | null }
type ToolArgs = Record<string, unknown>

const OBJ = (properties: Record<string, unknown>, required?: string[]) =>
  ({ type: 'OBJECT', properties, ...(required ? { required } : {}) })
const STR = (description: string) => ({ type: 'STRING', description })
const INT = (description: string) => ({ type: 'INTEGER', description })

export const TOOL_DECLARATIONS = [
  // ── Discovery / market ──────────────────────────────────────────
  { name: 'search_artworks', description: 'Tìm artwork ACTIVE theo tên/ticker → giá, supply, trạng thái.', parameters: OBJ({ query: STR('tên/ticker'), limit: INT('mặc định 5') }, ['query']) },
  { name: 'get_artwork_details', description: 'Chi tiết 1 artwork: mô tả, creator, curve, royalty, target cap, % tiến độ graduation.', parameters: OBJ({ query: STR('tên/ticker artwork') }, ['query']) },
  { name: 'get_artwork_chart', description: 'Tóm tắt biến động giá (OHLCV nến ngày) của 1 artwork trong N ngày gần đây.', parameters: OBJ({ query: STR('tên/ticker'), days: INT('số ngày, mặc định 14') }, ['query']) },
  { name: 'get_artwork_social', description: 'Số like, số comment, điểm đánh giá trung bình của 1 artwork.', parameters: OBJ({ query: STR('tên/ticker') }, ['query']) },
  { name: 'get_top_holders', description: 'Top người nắm giữ nhiều nhất của 1 artwork (xếp hạng theo % sở hữu).', parameters: OBJ({ query: STR('tên/ticker'), limit: INT('mặc định 5') }, ['query']) },
  { name: 'get_marketplace', description: 'Danh sách artwork ACTIVE. sortBy: trending|price|created_at|view_count.', parameters: OBJ({ sortBy: STR('cách sắp xếp'), limit: INT('mặc định 8') }) },
  { name: 'get_trending', description: 'Top artwork theo khối lượng giao dịch (leaderboard 7 ngày).', parameters: OBJ({ limit: INT('mặc định 8') }) },
  { name: 'get_recent_trades', description: 'Các giao dịch mới nhất toàn sàn (live activity).', parameters: OBJ({ limit: INT('mặc định 10') }) },
  { name: 'get_platform_stats', description: 'Thống kê sàn: số artwork active, tổng volume ETH, số collector.', parameters: OBJ({}) },
  // ── Live & people ──────────────────────────────────────────────
  { name: 'get_live_streams', description: 'Các phiên live đang phát + số người xem.', parameters: OBJ({}) },
  { name: 'get_top_creators', description: 'Các nghệ sĩ/creator nổi bật theo số tác phẩm.', parameters: OBJ({ limit: INT('mặc định 8') }) },
  // ── Guild ──────────────────────────────────────────────────────
  { name: 'list_guilds', description: 'Danh sách guild để gợi ý gia nhập.', parameters: OBJ({ limit: INT('mặc định 8') }) },
  { name: 'get_guild_details', description: 'Chi tiết 1 guild theo tên: số thành viên, focus, holdings chung.', parameters: OBJ({ name: STR('tên guild') }, ['name']) },
  // ── Account (cần đăng nhập) ────────────────────────────────────
  { name: 'get_my_portfolio', description: 'Tổng quan portfolio của tôi: giá trị, P&L chưa/đã thực hiện.', parameters: OBJ({}) },
  { name: 'get_my_holdings', description: 'Danh sách artwork tôi đang giữ + P&L từng vị thế.', parameters: OBJ({}) },
  { name: 'get_my_transactions', description: 'Lịch sử giao dịch gần đây của tôi.', parameters: OBJ({ limit: INT('mặc định 10') }) },
  { name: 'get_my_performance', description: 'Diễn biến giá trị portfolio của tôi theo thời gian. period: 7d|30d|90d.', parameters: OBJ({ period: STR('7d|30d|90d') }) },
] as const

@Injectable()
export class ChatToolsService {
  private readonly logger = new Logger(ChatToolsService.name)

  constructor(
    private readonly artworks: ArtworksService,
    private readonly vault: VaultService,
    private readonly guild: GuildService,
    private readonly trades: TradesService,
    private readonly social: SocialService,
    private readonly live: LiveService,
    private readonly users: UsersService,
    private readonly portfolio: PortfolioService,
  ) {}

  get declarations() { return TOOL_DECLARATIONS }

  async execute(name: string, args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    try {
      switch (name) {
        case 'search_artworks':     return await this.searchArtworks(args)
        case 'get_artwork_details': return await this.artworkDetails(args)
        case 'get_artwork_chart':   return await this.artworkChart(args)
        case 'get_artwork_social':  return await this.artworkSocial(args)
        case 'get_top_holders':     return await this.topHolders(args)
        case 'get_marketplace':     return await this.getMarketplace(args)
        case 'get_trending':        return await this.trending(args)
        case 'get_recent_trades':   return await this.recentTrades(args)
        case 'get_platform_stats':  return { ...(await this.artworks.getPlatformStats()) }
        case 'get_live_streams':    return await this.liveStreams()
        case 'get_top_creators':    return await this.topCreators(args)
        case 'list_guilds':         return await this.listGuilds(args)
        case 'get_guild_details':   return await this.guildDetails(args)
        case 'get_my_portfolio':    return await this.myPortfolio(ctx)
        case 'get_my_holdings':     return await this.myHoldings(ctx)
        case 'get_my_transactions': return await this.myTransactions(args, ctx)
        case 'get_my_performance':  return await this.myPerformance(args, ctx)
        default:                    return { error: `unknown_tool:${name}` }
      }
    } catch (err) {
      this.logger.warn(`Tool ${name} failed: ${(err as Error).message}`)
      return { error: 'tool_failed', message: (err as Error).message }
    }
  }

  // ── helper: tên → artwork ──────────────────────────────────────
  private async resolve(query: string): Promise<{ id: string; title: string; ticker: string } | null> {
    const q = String(query ?? '').trim()
    if (!q) return null
    const res = await this.artworks.searchArtworks({ q, limit: 1 } as any)
    const a: any = res.data?.[0]
    return a ? { id: a.id, title: a.title, ticker: a.ticker } : null
  }

  // ── discovery / market ─────────────────────────────────────────
  private async searchArtworks(args: ToolArgs) {
    const query = String(args.query ?? '').trim()
    if (!query) return { error: 'missing_query' }
    const res = await this.artworks.searchArtworks({ q: query, limit: Math.min(Number(args.limit) || 5, 20) } as any)
    return { count: res.total, results: res.data.map((a: any) => ({ title: a.title, ticker: a.ticker, status: a.status, price_eth: a.current_price, supply: a.current_supply })) }
  }

  private async artworkDetails(args: ToolArgs) {
    const found = await this.resolve(String(args.query ?? ''))
    if (!found) return { error: 'artwork_not_found' }
    const a: any = await this.artworks.getArtworkById(found.id)
    const cap = parseFloat(a.target_cap ?? '0')
    const marketCap = parseFloat(a.current_price ?? '0') * parseFloat(a.current_supply ?? '0')
    const progress = cap > 0 ? Math.min(100, (marketCap / cap) * 100) : 0
    return {
      title: a.title, ticker: a.ticker, status: a.status, description: a.description ?? undefined,
      price_eth: a.current_price, supply: a.current_supply, target_cap_eth: a.target_cap,
      curve_type: a.curve_type, royalty_pct: a.royalty_pct, views: a.view_count,
      graduation_progress_pct: Number(progress.toFixed(1)),
      creator: a.creator ? { username: a.creator.username, wallet: a.creator.wallet_address } : undefined,
    }
  }

  private async artworkChart(args: ToolArgs) {
    const found = await this.resolve(String(args.query ?? ''))
    if (!found) return { error: 'artwork_not_found' }
    const days = Math.min(Number(args.days) || 14, 90)
    const to = new Date(); const from = new Date(Date.now() - days * 86400000)
    const candles = await this.trades.getOhlcv({ artworkId: found.id, timeframe: '1d' as any, from, to, limit: days })
    if (!candles.length) return { title: found.title, note: 'Chưa có dữ liệu giao dịch trong khoảng này.' }
    const closes = candles.map((c) => parseFloat(c.close))
    const first = closes[0]; const last = closes[closes.length - 1]
    const changePct = first > 0 ? ((last - first) / first) * 100 : 0
    return {
      title: found.title, ticker: found.ticker, days,
      open: candles[0].open, close: candles[candles.length - 1].close,
      high: Math.max(...candles.map((c) => parseFloat(c.high))).toString(),
      low: Math.min(...candles.map((c) => parseFloat(c.low))).toString(),
      change_pct: Number(changePct.toFixed(2)), candle_count: candles.length,
    }
  }

  private async artworkSocial(args: ToolArgs) {
    const found = await this.resolve(String(args.query ?? ''))
    if (!found) return { error: 'artwork_not_found' }
    const stats = await this.social.getArtworkStats(found.id)
    return { title: found.title, ...stats }
  }

  private async topHolders(args: ToolArgs) {
    const found = await this.resolve(String(args.query ?? ''))
    if (!found) return { error: 'artwork_not_found' }
    const rows = await this.portfolio.getTopHolders(found.id, Math.min(Number(args.limit) || 5, 20))
    return { title: found.title, holders: rows.map((h) => ({ rank: h.rank, holder: h.username || h.wallet_address, shares: h.share_balance, ownership_pct: h.ownership_pct })) }
  }

  private async getMarketplace(args: ToolArgs) {
    const allowed = ['trending', 'price', 'created_at', 'view_count']
    const sortBy = allowed.includes(String(args.sortBy)) ? String(args.sortBy) : 'trending'
    const res = await this.artworks.getMarketplace(sortBy as any, 1, Math.min(Number(args.limit) || 8, 20))
    return { sortBy, results: res.data.map((a: any) => ({ title: a.title, ticker: a.ticker, price_eth: a.current_price, views: a.view_count })) }
  }

  private async trending(args: ToolArgs) {
    const rows = await this.trades.getTopByVolume(Math.min(Number(args.limit) || 8, 20))
    return { results: rows }
  }

  private async recentTrades(args: ToolArgs) {
    const rows = await this.trades.getRecentTrades(Math.min(Number(args.limit) || 10, 30))
    return { results: rows }
  }

  // ── live & people ──────────────────────────────────────────────
  private async liveStreams() {
    const rows = await this.live.listLive()
    return { count: rows.length, streams: rows.map((s: any) => ({ title: s.title, host: s.host_name, category: s.category, viewers: s.viewer_count })) }
  }

  private async topCreators(args: ToolArgs) {
    const rows = await this.users.getTopCreators(Math.min(Number(args.limit) || 8, 20))
    return { results: rows.map((u: any) => ({ username: u.username, wallet: u.wallet_address, verified: u.is_verified })) }
  }

  // ── guild ──────────────────────────────────────────────────────
  private async listGuilds(args: ToolArgs) {
    const result = await this.guild.listGuilds()
    return { results: result.data.slice(0, Math.min(Number(args.limit) || 8, 20)).map((g: any) => ({ name: g.name, focus: g.focus, members: g.member_count })) }
  }

  private async guildDetails(args: ToolArgs) {
    const name = String(args.name ?? '').trim().toLowerCase()
    if (!name) return { error: 'missing_name' }
    const result = await this.guild.listGuilds()
    const g: any = result.data.find((x: any) => String(x.name).toLowerCase().includes(name))
    if (!g) return { error: 'guild_not_found' }
    const holdings = await this.guild.getHoldings(g.id).catch(() => [])
    return {
      name: g.name, focus: g.focus, members: g.member_count, description: g.description ?? undefined,
      collective_holdings: (holdings as any[]).slice(0, 5).map((h) => ({ title: h.title, shares: h.total_shares, holders: h.holder_count })),
    }
  }

  // ── account ────────────────────────────────────────────────────
  private async myPortfolio(ctx: ToolContext): Promise<Record<string, unknown>> {
    if (!ctx.userId) return { error: 'not_signed_in' }
    return { ...(await this.vault.getOverview(ctx.userId)) }
  }

  private async myHoldings(ctx: ToolContext) {
    if (!ctx.userId) return { error: 'not_signed_in' }
    const rows = await this.vault.getHoldings(ctx.userId)
    return { count: rows.length, holdings: rows.map((h) => ({ title: h.title, ticker: h.ticker, shares: h.share_balance, price_eth: h.current_price, value_eth: h.value_eth, pnl_eth: h.pnl_eth, pnl_pct: h.pnl_pct })) }
  }

  private async myTransactions(args: ToolArgs, ctx: ToolContext) {
    if (!ctx.userId) return { error: 'not_signed_in' }
    const res = await this.trades.getUserTransactionHistory(ctx.userId, 1, Math.min(Number(args.limit) || 10, 30))
    return { count: res.total, transactions: res.data.map((t: any) => ({ type: t.tx_type, artwork: t.artwork_title, shares: t.share_amount, eth: t.eth_amount, price: t.price_per_share, at: t.timestamp })) }
  }

  private async myPerformance(args: ToolArgs, ctx: ToolContext) {
    if (!ctx.userId) return { error: 'not_signed_in' }
    const period = ['7d', '30d', '90d'].includes(String(args.period)) ? String(args.period) as '7d' | '30d' | '90d' : '30d'
    const points = await this.vault.getPerformance(ctx.userId, period)
    const first = points[0]?.value_eth; const last = points[points.length - 1]?.value_eth
    return { period, start_value_eth: first, end_value_eth: last, points_count: points.length }
  }
}
