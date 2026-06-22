import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { UseGuards, Logger, Inject } from '@nestjs/common';
import sanitizeHtml = require('sanitize-html');
import { Server, Socket } from 'socket.io';
import { Web3AuthGuard } from '../../common/guards/web3-auth.guard';
import { ChatService } from './chat.service';
import { RedisService } from '../../shared/redis/redis.service';

const CHAT_CORS_ORIGINS = [
  process.env.FRONTEND_URL ?? 'https://artcurve-fe.vercel.app',
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3000', 'http://localhost:3001']
    : []),
].filter(Boolean);

@UseGuards(Web3AuthGuard)
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: CHAT_CORS_ORIGINS,
    credentials: true,
  },
  pingInterval: 25_000,
  pingTimeout: 10_000,
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatSvc: ChatService,
    private readonly redisService: RedisService,
  ) {}

  handleConnection(client: Socket) {
    const userId = (client as any).data?.user?.sub;
    this.logger.log(`Chat client connected: ${client.id} user=${userId ?? 'unknown'}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Chat client disconnected: ${client.id}`);
  }

  @SubscribeMessage('chat:send')
  async handleSend(
    @MessageBody() data: { content: string; session_id?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = (client as any).data?.user?.sub;
    if (!userId) {
      client.emit('chat:error', { message: 'Not authenticated' });
      return;
    }

    // Rate limit: max 30 messages per minute per user
    const rateLimitKey = `chat:rate:${userId}`;
    const count = await this.redisService.increment(rateLimitKey);
    if (count === 1) await this.redisService.expire(rateLimitKey, 60);
    if (count > 30) {
      client.emit('chat:error', { message: 'Too many messages. Please wait.' });
      return;
    }

    const sanitizedContent = sanitizeHtml(data.content, { allowedTags: [], allowedAttributes: {} }).trim();

    if (!sanitizedContent || sanitizedContent.length > 2000) {
      client.emit('chat:error', { message: 'Invalid message content' });
      return;
    }

    try {
      const result = await this.chatSvc.sendMessage(userId, {
        content: sanitizedContent,
        session_id: data.session_id,
      });

      const room = `chat:session:${result.userMsg.session_id}`;
      client.join(room);

      client.emit('chat:ai_response', {
        session_id: result.userMsg.session_id,
        user_message: result.userMsg,
        ai_message: result.aiMsg,
        should_escalate: result.shouldEscalate,
      });
    } catch (err: any) {
      this.logger.error(`chat:send error: ${err.message}`);
      client.emit('chat:error', { message: 'Failed to process message' });
    }
  }

  @SubscribeMessage('chat:history')
  async handleHistory(
    @MessageBody() data: { session_id: string; limit?: number; offset?: number },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = (client as any).data?.user?.sub;
    if (!userId) {
      client.emit('chat:error', { message: 'Not authenticated' });
      return;
    }

    try {
      const limit = Math.min(Math.max(data.limit ?? 50, 1), 100);
      const offset = Math.max(data.offset ?? 0, 0);
      const messages = await this.chatSvc.getHistory(
        data.session_id,
        userId,
        limit,
        offset,
      );
      client.emit('chat:history_response', { session_id: data.session_id, messages });
    } catch (err: any) {
      client.emit('chat:error', { message: 'Failed to load history' });
    }
  }
}
