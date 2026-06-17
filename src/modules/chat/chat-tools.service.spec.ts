import { Test } from '@nestjs/testing';
import { ChatToolsService } from './chat-tools.service';
import { ArtworksService } from '../artworks/artworks.service';
import { VaultService } from '../vault/vault.service';
import { GuildService } from '../guild/guild.service';
import { TradesService } from '../trades/trades.service';
import { SocialService } from '../social/social.service';
import { LiveService } from '../live/live.service';
import { UsersService } from '../users/users.service';
import { PortfolioService } from '../portfolio/portfolio.service';

describe('ChatToolsService', () => {
  let svc: ChatToolsService;
  let artworks: any; let vault: any; let guild: any;
  let trades: any; let social: any; let live: any; let users: any; let portfolio: any;

  beforeEach(async () => {
    artworks = { searchArtworks: jest.fn(), getMarketplace: jest.fn(), getPlatformStats: jest.fn(), getArtworkById: jest.fn() };
    vault = { getOverview: jest.fn(), getHoldings: jest.fn(), getPerformance: jest.fn() };
    guild = { listGuilds: jest.fn(), getHoldings: jest.fn() };
    trades = { getOhlcv: jest.fn(), getTopByVolume: jest.fn(), getRecentTrades: jest.fn(), getUserTransactionHistory: jest.fn() };
    social = { getArtworkStats: jest.fn() };
    live = { listLive: jest.fn() };
    users = { getTopCreators: jest.fn() };
    portfolio = { getTopHolders: jest.fn() };
    const m = await Test.createTestingModule({
      providers: [
        ChatToolsService,
        { provide: ArtworksService, useValue: artworks },
        { provide: VaultService, useValue: vault },
        { provide: GuildService, useValue: guild },
        { provide: TradesService, useValue: trades },
        { provide: SocialService, useValue: social },
        { provide: LiveService, useValue: live },
        { provide: UsersService, useValue: users },
        { provide: PortfolioService, useValue: portfolio },
      ],
    }).compile();
    svc = m.get(ChatToolsService);
  });

  it('search_artworks maps gọn kết quả', async () => {
    artworks.searchArtworks.mockResolvedValue({ total: 1, page: 1, data: [{ title: 'Pale', ticker: '$PALE', status: 'ACTIVE', current_price: '1.8', current_supply: '100' }] });
    const r = await svc.execute('search_artworks', { query: 'pale' }, {});
    expect(artworks.searchArtworks).toHaveBeenCalled();
    expect((r as any).results[0]).toMatchObject({ title: 'Pale', ticker: '$PALE', price_eth: '1.8' });
  });

  it('search_artworks thiếu query → lỗi', async () => {
    const r = await svc.execute('search_artworks', {}, {});
    expect(r).toEqual({ error: 'missing_query' });
  });

  it('get_my_portfolio chưa đăng nhập → not_signed_in (không gọi vault)', async () => {
    const r = await svc.execute('get_my_portfolio', {}, { userId: null });
    expect(r).toEqual({ error: 'not_signed_in' });
    expect(vault.getOverview).not.toHaveBeenCalled();
  });

  it('get_my_portfolio dùng đúng userId của phiên', async () => {
    vault.getOverview.mockResolvedValue({ total_value_eth: '2.5', realized_pnl_eth: '0.1' });
    await svc.execute('get_my_portfolio', {}, { userId: 'u-9' });
    expect(vault.getOverview).toHaveBeenCalledWith('u-9');
  });

  it('tool lỗi được gói lại, không throw', async () => {
    vault.getHoldings.mockRejectedValue(new Error('db down'));
    const r = await svc.execute('get_my_holdings', {}, { userId: 'u-9' });
    expect((r as any).error).toBe('tool_failed');
  });

  it('tool không tồn tại → unknown_tool', async () => {
    const r = await svc.execute('do_evil', {}, {});
    expect((r as any).error).toContain('unknown_tool');
  });

  it('get_my_transactions chưa đăng nhập → not_signed_in', async () => {
    const r = await svc.execute('get_my_transactions', {}, {});
    expect(r).toEqual({ error: 'not_signed_in' });
    expect(trades.getUserTransactionHistory).not.toHaveBeenCalled();
  });

  it('get_live_streams map gọn', async () => {
    live.listLive.mockResolvedValue([{ title: 'Painting live', host_name: 'soo', category: 'art', viewer_count: 12 }]);
    const r = await svc.execute('get_live_streams', {}, {});
    expect((r as any).count).toBe(1);
    expect((r as any).streams[0]).toMatchObject({ title: 'Painting live', viewers: 12 });
  });

  it('get_artwork_details: resolve theo tên rồi lấy chi tiết + % graduation', async () => {
    artworks.searchArtworks.mockResolvedValue({ total: 1, data: [{ id: 'a1', title: 'Pale', ticker: '$PALE' }] });
    artworks.getArtworkById.mockResolvedValue({ title: 'Pale', ticker: '$PALE', status: 'ACTIVE', current_price: '2', current_supply: '50', target_cap: '200', curve_type: 'quadratic', royalty_pct: '5.00' });
    const r: any = await svc.execute('get_artwork_details', { query: 'pale' }, {});
    expect(r.title).toBe('Pale');
    expect(r.graduation_progress_pct).toBe(50); // 2*50/200 = 50%
  });

  it('get_artwork_details: không tìm thấy → artwork_not_found', async () => {
    artworks.searchArtworks.mockResolvedValue({ total: 0, data: [] });
    const r = await svc.execute('get_artwork_details', { query: 'zzz' }, {});
    expect((r as any).error).toBe('artwork_not_found');
  });
});
