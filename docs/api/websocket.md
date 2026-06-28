# WebSocket Events

ArtCurve uses two WebSocket namespaces for real-time data delivery via Socket.IO, plus a native WebSocket endpoint via the Go ws-hub.

## Socket.IO Namespaces

### `/prices` — Public (no auth required)

Real-time artwork price updates. No authentication needed.

**Connection:**
```js
import { io } from 'socket.io-client'

const socket = io('https://api.artcurve.io/prices', {
  transports: ['websocket'],
})
```

**Client → Server Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe_artwork` | `{ artwork_id: string }` | Subscribe to price updates for an artwork |
| `unsubscribe_artwork` | `{ artwork_id: string }` | Unsubscribe from price updates |

**Server → Client Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `price_snapshot` | `{ artwork_id, current_price, current_supply, volume_24h, updated_at }` | Immediate snapshot upon subscribing |
| `price_update` | `{ artwork_id, current_price, current_supply, volume_24h, timestamp, is_buy, user_wallet, share_amount }` | Real-time update on every trade |
| `artwork_graduated` | `{ artwork_id, timestamp }` | Artwork has graduated to DEX |

### `/events` — JWT Required

Authenticated event stream for trade details.

**Connection:**
```js
const socket = io('https://api.artcurve.io/events', {
  auth: { token: 'Bearer eyJ...' },
  transports: ['websocket'],
})
```

**Server → Client Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `trade_updated` | `{ artwork_id, tx_hash, is_buy, user_wallet, share_amount, eth_amount, price_per_share, block_number, timestamp }` | Detailed trade event |
| `price_snapshot` | Same as /prices namespace | Price snapshot |
| `artwork_graduated` | `{ artwork_id, timestamp }` | Graduation event |

## Go ws-hub — Native WebSocket

Lower-latency alternative to Socket.IO. Subscribes to Redis Pub/Sub and broadcasts to connected clients.

**Connection:**
```js
const ws = new WebSocket('wss://ws-hub.artcurve.io/ws')
```

**Client → Server:**
```json
{ "action": "subscribe", "artwork_id": "uuid" }
{ "action": "unsubscribe", "artwork_id": "uuid" }
```

**Server → Client:**
```json
{ "type": "price_update", "data": { "artwork_id": "...", "current_price": "...", ... } }
```

## Data Flow

```
On-chain Trade → BlockchainIndexer
    → RabbitMQ → BlockchainEventConsumer
    → PostgreSQL update + Redis PUBLISH artwork:price:updated
    → Socket.IO /prices gateway → clients
    → Go ws-hub (Redis subscriber) → clients
```
