---
name: websocket
description: Scaffold a NestJS WebSocket gateway with Socket.io for ArtCurve backend (NestJS + Socket.io + RabbitMQ) — JWT guard on handshake, tenant room isolation, RabbitMQ → broadcast pattern, and Next.js client hook with Zustand store. Use this skill whenever the user needs real-time communication, live updates, push notifications, WebSocket events, socket rooms, or any feature that requires the server to push data to the client without polling.
---

You are scaffolding or reviewing **WebSocket real-time communication** for the ArtCurve backend (NestJS + Socket.io + RabbitMQ) and its Next.js frontend.

> **Priority rule**: Always follow NestJS, Socket.io, and security best practices. If existing code falls back to query params for tokens or skips authentication on connection, flag it and provide the corrected version.

---

## DOCUMENTATION — consult before generating

- **NestJS WebSockets**: https://docs.nestjs.com/websockets/gateways
- **NestJS WS Guards**: https://docs.nestjs.com/websockets/guards
- **NestJS WS Exception Filters**: https://docs.nestjs.com/websockets/exception-filters
- **Socket.io Server**: https://socket.io/docs/v4/server-api/
- **Socket.io Rooms**: https://socket.io/docs/v4/rooms/
- **Socket.io Client**: https://socket.io/docs/v4/client-api/
- **@nestjs/platform-socket.io**: https://www.npmjs.com/package/@nestjs/platform-socket.io

Fetch the relevant page when uncertain about any decorator, option, or adapter config.

---

## STEP 1 — Gather specification

Ask the user for any missing information. Required:

- **Domain / feature name** (singular PascalCase): e.g. `Notification`, `Chat`, `ActivityFeed`
- **Events the server emits** (server → client): list of event names + payload shape
  - e.g. `notification.created` → `{ id, message, type }`
- **Events the client sends** (client → server): list of event names + payload shape (if any)
  - e.g. `message.send` → `{ conversationId, text }`
- **Source of events**: what triggers a server emit?
  - Option A: **RabbitMQ** — a microservice publishes an event → gateway broadcasts to room
  - Option B: **Direct** — a client event triggers a response (chat-style)
  - Option C: **Both**
- **Target service** where the Gateway lives: `apps/api-gateway` (default) | new standalone service
- **Needs frontend hook?** (default: yes) — generates `useSocket` hook + Zustand slice

Optional:
- **Namespace**: e.g. `/notifications` (default: `/`) — use a namespace per domain
- **Room strategy**: `tenantId` (default) | `userId` | `resourceId` | custom
- **Max listeners per socket** (default: 10)

---

## STEP 2 — Derive naming conventions

From domain name (e.g. `Notification`):

| Derived name | Example |
|---|---|
| `domainPlural` (camelCase) | `notifications` |
| `DomainPlural` (PascalCase) | `Notifications` |
| `gatewayFile` | `notifications.gateway.ts` |
| `gatewayClass` | `NotificationsGateway` |
| `guardFile` | `ws-auth.guard.ts` (shared, reuse if exists) |
| `namespace` | `/notifications` |
| `rmqConsumerFile` | `notifications-ws.consumer.ts` |
| `storeFile` | `use-notifications-socket.ts` |

File paths (assuming `apps/api-gateway`):

```
apps/api-gateway/src/realtime/
├── <domainPlural>/
│   ├── <domainPlural>.gateway.ts       # @WebSocketGateway
│   └── <domainPlural>-ws.consumer.ts  # RabbitMQ consumer → broadcasts
├── guards/
│   └── ws-auth.guard.ts               # Shared JWT guard for all WS connections
└── realtime.module.ts                 # Registers all gateways + WsGuard
```

Frontend:
```
apps/web/src/features/<domainPlural>/realtime/
└── use-<domainPlural>-socket.ts       # Hook with socket.io-client + Zustand integration
```

---

## STEP 3 — Generate the WsAuthGuard (skip if already exists)

This guard runs **once per connection** during the handshake, not on every message. This is the most important security boundary — authenticate here, not inside event handlers.

### File: `apps/api-gateway/src/realtime/guards/ws-auth.guard.ts`

```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();

    // ALWAYS read from handshake.auth — never from query params (logged by proxies)
    const token = client.handshake.auth?.token as string | undefined;

    if (!token) {
      client.disconnect(true); // Reject immediately, do not let connection linger
      throw new WsException('Unauthorized: missing token');
    }

    try {
      const payload = this.jwtService.verify(token);
      // Attach to socket data so event handlers can read it without re-verifying
      client.data.user = payload;
      client.data.tenantId = payload.tenantId; // Adjust to your JWT shape
      return true;
    } catch {
      client.disconnect(true);
      throw new WsException('Unauthorized: invalid token');
    }
  }
}
```

**Why `handshake.auth.token`?** Query params are logged by proxies, CDNs, and load balancers. The `auth` object is transmitted in the connection payload and is not part of the URL.

**Why `disconnect(true)` on failure?** Passing `true` forces a close without waiting for acknowledgment — it prevents the connection from lingering and consuming resources while an attacker probes the gateway.

---

## STEP 4 — Generate the WebSocket Gateway

### File: `apps/api-gateway/src/realtime/<domainPlural>/<domainPlural>.gateway.ts`

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { UseGuards, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WsAuthGuard } from '../guards/ws-auth.guard';

@WebSocketGateway({
  namespace: '/notifications',   // One namespace per domain — keeps events scoped
  cors: { origin: process.env.FRONTEND_URL, credentials: true },
  transports: ['websocket'],     // Disable long-polling — simpler, fewer edge cases
})
@UseGuards(WsAuthGuard)          // Applied to all events in this gateway
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(NotificationsGateway.name);

  async handleConnection(client: Socket): Promise<void> {
    // WsAuthGuard has already verified the token by now
    const tenantId = client.data.tenantId as string;

    if (!tenantId) {
      client.disconnect(true);
      return;
    }

    // Each tenant gets its own room — prevents cross-tenant event leakage
    await client.join(`tenant:${tenantId}`);
    this.logger.log(`Client ${client.id} joined room tenant:${tenantId}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client ${client.id} disconnected`);
    // socket.io removes the socket from all rooms automatically on disconnect
  }

  // Example: client-initiated event
  @SubscribeMessage('notification.markRead')
  handleMarkRead(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const { tenantId, user } = client.data;
    // Delegate to a service — don't put business logic here
    this.logger.log(`User ${user.sub} marking ${data.notificationId} read in tenant ${tenantId}`);
    // this.notificationsService.markRead(data.notificationId, tenantId);
  }
}
```

**Key patterns:**
- `@UseGuards(WsAuthGuard)` at the class level — applies to every event, not just specific ones
- Room name as `tenant:<id>` — namespaced key prevents collisions if you add other room types later
- `@ConnectedSocket()` gives access to `client.data` where the guard stored the verified payload
- No business logic in the gateway — delegate to a service

---

## STEP 5 — Generate the RabbitMQ Consumer (Option A — RabbitMQ source)

This consumer listens for microservice events and broadcasts them to the correct tenant room. This is the recommended pattern: microservices don't know about sockets, they just publish to RabbitMQ.

### File: `apps/api-gateway/src/realtime/<domainPlural>/<domainPlural>-ws.consumer.ts`

```typescript
import { Controller, Logger } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { NotificationsGateway } from './notifications.gateway';

// Shape of the RabbitMQ message — align with what the microservice publishes
interface NotificationCreatedEvent {
  tenantId: string;
  notification: {
    id: string;
    message: string;
    type: string;
    userId?: string; // undefined = broadcast to entire tenant
  };
}

@Controller()
export class NotificationsWsConsumer {
  private readonly logger = new Logger(NotificationsWsConsumer.name);

  constructor(private readonly gateway: NotificationsGateway) {}

  @EventPattern('notification.created')
  handleNotificationCreated(
    @Payload() event: NotificationCreatedEvent,
    @Ctx() context: RmqContext,
  ): void {
    const channel = context.getChannelRef();
    const originalMessage = context.getMessage();

    try {
      const { tenantId, notification } = event;

      if (notification.userId) {
        // Emit only to a specific user's sockets within the tenant
        this.gateway.server
          .to(`tenant:${tenantId}`)
          .except(`user:${notification.userId}`) // example of targeting
          .emit('notification.created', notification);
      } else {
        // Broadcast to all sockets in the tenant room
        this.gateway.server
          .to(`tenant:${tenantId}`)
          .emit('notification.created', notification);
      }

      channel.ack(originalMessage); // Always ack on success
    } catch (error) {
      this.logger.error('Failed to broadcast notification', error);
      channel.nack(originalMessage, false, false); // nack without requeue to avoid poison messages
    }
  }
}
```

**Why ack/nack here?** WebSocket broadcast is a side-effect — if it fails (e.g., gateway server crashed), we don't want the event to requeue infinitely. Nack without requeue sends it to the dead-letter queue for manual inspection.

---

## STEP 6 — Register in the module

### File: `apps/api-gateway/src/realtime/realtime.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationsGateway } from './notifications/notifications.gateway';
import { NotificationsWsConsumer } from './notifications/notifications-ws.consumer';
import { WsAuthGuard } from './guards/ws-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        // Do NOT set signOptions here — this module only verifies, never signs
      }),
    }),
  ],
  providers: [
    WsAuthGuard,
    NotificationsGateway,
    NotificationsWsConsumer,
  ],
})
export class RealtimeModule {}
```

Then import `RealtimeModule` in your `AppModule` (or the root api-gateway module).

**Adapter setup** — ensure `socket.io` adapter is configured in `main.ts`:

```typescript
import { IoAdapter } from '@nestjs/platform-socket.io';

// Inside bootstrap():
app.useWebSocketAdapter(new IoAdapter(app));
```

---

## STEP 7 — Generate the Frontend Hook (Next.js + Zustand)

### File: `apps/web/src/features/<domainPlural>/realtime/use-<domainPlural>-socket.ts`

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth.store'; // Adjust to your auth store path

// Define the event payload types
interface NotificationPayload {
  id: string;
  message: string;
  type: string;
}

// Zustand-compatible signature — pass your store's setter
type OnNotification = (notification: NotificationPayload) => void;

export function useNotificationsSocket(onNotification: OnNotification): void {
  const token = useAuthStore((s) => s.accessToken);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return; // Do not connect if unauthenticated

    const socket = io(`${process.env.NEXT_PUBLIC_API_URL}/notifications`, {
      auth: { token },           // Passed to handshake.auth on the server
      transports: ['websocket'], // Match server config — no long-polling fallback
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.debug('[NotificationsSocket] connected', socket.id);
    });

    socket.on('notification.created', (payload: NotificationPayload) => {
      onNotification(payload); // Delegate to the store/callback — hook stays thin
    });

    socket.on('disconnect', (reason) => {
      console.debug('[NotificationsSocket] disconnected', reason);
    });

    socket.on('connect_error', (error) => {
      console.error('[NotificationsSocket] connection error', error.message);
      // If the server rejects due to auth, stop retrying
      if (error.message.includes('Unauthorized')) {
        socket.disconnect();
      }
    });

    return () => {
      socket.disconnect(); // Clean up on unmount or token change
      socketRef.current = null;
    };
  }, [token, onNotification]); // Reconnect if token changes (e.g., refresh)
}
```

**Usage in a component or layout:**

```typescript
// In a Zustand store (e.g., use-notifications-store.ts):
export const useNotificationsStore = create<NotificationsState>((set) => ({
  notifications: [],
  addNotification: (n) => set((s) => ({ notifications: [n, ...s.notifications] })),
}));

// In a Client Component:
export function NotificationsProvider() {
  const addNotification = useNotificationsStore((s) => s.addNotification);
  useNotificationsSocket(addNotification);
  return null; // This component only connects the socket — renders nothing
}
```

Place `<NotificationsProvider />` in your root layout (inside the auth boundary) so it mounts once and stays mounted.

---

## STEP 8 — Review checklist

Before finishing, verify each item:

### Security
- [ ] Token read from `handshake.auth.token`, **not** query params
- [ ] `WsAuthGuard` applied at class level (not only on individual event handlers)
- [ ] Invalid token → `client.disconnect(true)` + `WsException`
- [ ] User data stored in `client.data` after verification — not re-verified per message
- [ ] CORS `origin` set to `process.env.FRONTEND_URL` — not `*`
- [ ] `transports: ['websocket']` on both server and client (no long-polling fallback that could bypass auth headers)

### Multi-tenancy
- [ ] Every socket joins `tenant:<tenantId>` on connection
- [ ] All broadcasts target `tenant:<tenantId>` room — no global emits
- [ ] `tenantId` comes from the verified JWT payload, not from the client payload

### Error handling
- [ ] RabbitMQ consumer acks on success, nacks (no requeue) on failure
- [ ] `connect_error` handler on frontend stops retrying on auth errors
- [ ] Gateway uses `Logger` — no `console.log`

### Module wiring
- [ ] `IoAdapter` registered in `main.ts`
- [ ] `JwtModule` imported in `RealtimeModule`
- [ ] `RealtimeModule` imported in root `AppModule`
- [ ] Consumer decorated with `@Controller()` and registered in module providers

---

## RULES

- **Never** read the JWT token from `socket.handshake.query` — it gets logged by proxies and CDNs.
- **Never** validate the token inside `@SubscribeMessage` handlers — authenticate once on connection in the guard, cache the result in `client.data`.
- **Never** emit to `this.server.emit(...)` without a room — that broadcasts to all tenants.
- **Never** put business logic in the gateway — keep gateways thin and delegate to services.
- **Never** skip `channel.ack()` in a RabbitMQ consumer — unacked messages will block the queue.
- If the existing code breaks any of these rules, flag it first and provide a corrected version before continuing.
- If the user only asks for the frontend hook, still show the auth pattern for `handshake.auth` and explain why.
- Follow the existing project patterns: `BaseRpcException` for microservice errors, `RequestContextService` for tenant context, `Logger` (not `console`) for logging.
