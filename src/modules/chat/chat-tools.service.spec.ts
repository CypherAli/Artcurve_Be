import { Test } from '@nestjs/testing';
import { ChatToolsService } from './chat-tools.service';
import { ArtworksService } from '../artworks/artworks.service';
import { VaultService } from '../vault/vault.service';
import { GuildService } from '../guild/guild.service';

describe('ChatToolsService', () => {
  let svc: ChatToolsService;
  let artworks: any; let vault: any; let guild: any;

  beforeEach(async () => {
    artworks = { searchArtworks: jest.fn(), getMarketplace: jest.fn(), getPlatformStats: jest.fn() };
    vault = { getOverview: jest.fn(), getHoldings: jest.fn() };
    guild = { listGuilds: jest.fn() };
    const m = await Test.createTestingModule({
      providers: [
        ChatToolsService,
        { provide: ArtworksService, useValue: artworks },
        { provide: VaultService, useValue: vault },
        { provide: GuildService, useValue: guild },
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
});
