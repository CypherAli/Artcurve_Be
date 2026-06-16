import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions, Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Logger } from '@nestjs/common';

// ─────────────────────────────────────────────────────────────────────────────
//  RedisIoAdapter — Socket.IO Redis adapter cho HORIZONTAL SCALING.
//
//  Vấn đề ở quy mô thực tế: khi chạy nhiều instance backend (Render scale, K8s
//  replicas), mỗi instance giữ tập kết nối WS riêng. server.to(room).emit() chỉ
//  tới client trên CÙNG instance → client ở instance khác không nhận được.
//
//  Redis adapter pub/sub-broadcast mọi emit qua Redis → mọi instance cùng phát
//  tới room → realtime đồng nhất bất kể client connect vào instance nào.
//
//  Fallback: không có Redis → dùng in-memory adapter mặc định (1 instance, dev).
// ─────────────────────────────────────────────────────────────────────────────

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger('RedisIoAdapter');
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  async connectToRedis(redisUrl: string): Promise<void> {
    const opts = { maxRetriesPerRequest: null as null, enableReadyCheck: true };
    this.pubClient = new Redis(redisUrl, opts);
    this.subClient = this.pubClient.duplicate();

    this.pubClient.on('error', (e) => this.logger.warn(`pub error: ${e.message}`));
    this.subClient.on('error', (e) => this.logger.warn(`sub error: ${e.message}`));

    // Đợi cả hai client sẵn sàng (hoặc lỗi) trước khi tạo adapter
    await Promise.all([
      this.pubClient.status === 'ready' ? Promise.resolve() : this.pubClient.connect().catch(() => {}),
      this.subClient.status === 'ready' ? Promise.resolve() : this.subClient.connect().catch(() => {}),
    ]);

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    this.logger.log('Socket.IO Redis adapter connected — horizontal scaling enabled');
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async close(): Promise<void> {
    await this.pubClient?.quit().catch(() => {});
    await this.subClient?.quit().catch(() => {});
  }
}
