import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { UseGuards, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Web3AuthGuard } from '../../common/guards/web3-auth.guard';
import { ChatService } from './chat.service';

@UseGuards(Web3AuthGuard)
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: (origin: string, cb: (err: Error | null, allow?: boolean) => void) => {
      cb(null, true);
    },
    credentials: true,
  },
  pingInterval: 25_000,
  pingTimeout: 10_000,
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly chatSvc: ChatService) {}

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

    try {
      const result = await this.chatSvc.sendMessage(userId, {
        content: data.content,
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
      client.emit('chat:error', { message: err.message });
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
      const messages = await this.chatSvc.getHistory(
        data.session_id,
        userId,
        data.limit ?? 50,
        data.offset ?? 0,
      );
      client.emit('chat:history_response', { session_id: data.session_id, messages });
    } catch (err: any) {
      client.emit('chat:error', { message: err.message });
    }
  }
}
