// hub/hub.go
// Central broadcast hub — manages rooms and fan-out.
//
// Design:
//   Each artwork_id has a room (set of *Client).
//   All mutations go through a single channel to avoid lock contention.
//
// Flow:
//   Redis sub → Hub.Broadcast(event) → find room → send to each Client.send

package hub

import (
	"encoding/json"
	"sync"

	"github.com/rs/zerolog/log"
)

// PriceEvent mirrors NestJS PriceUpdatedEvent shape
type PriceEvent struct {
	ArtworkID     string  `json:"artwork_id"`
	CurrentPrice  string  `json:"current_price"`
	CurrentSupply string  `json:"current_supply"`
	Volume24h     string  `json:"volume_24h"`
	TxHash        string  `json:"tx_hash"`
	Timestamp     int64   `json:"timestamp"`
	IsBuy         *bool   `json:"is_buy,omitempty"`
	UserWallet    *string `json:"user_wallet,omitempty"`
	ShareAmount   *string `json:"share_amount,omitempty"`
}

// GraduatedEvent mirrors artwork:graduated Redis channel
type GraduatedEvent struct {
	ArtworkID string `json:"artwork_id"`
	Timestamp int64  `json:"timestamp"`
}

// inbound message from Client to Hub
type subscription struct {
	client    *Client
	artworkID string
	subscribe bool // true=join, false=leave
}

// Hub manages all active client connections, grouped by artwork_id room
type Hub struct {
	// rooms[artworkID] = set of clients subscribed to that artwork
	rooms map[string]map[*Client]struct{}
	mu    sync.RWMutex

	// channels for concurrent-safe operations
	subCh   chan subscription
	unregCh chan *Client
}

func New() *Hub {
	return &Hub{
		rooms:   make(map[string]map[*Client]struct{}),
		subCh:   make(chan subscription, 256),
		unregCh: make(chan *Client, 256),
	}
}

// Run processes hub operations on a single goroutine — no mutex needed for room map
func (h *Hub) Run() {
	for {
		select {

		// client subscribes or unsubscribes from an artwork room
		case s := <-h.subCh:
			if s.subscribe {
				if _, ok := h.rooms[s.artworkID]; !ok {
					h.rooms[s.artworkID] = make(map[*Client]struct{})
				}
				h.rooms[s.artworkID][s.client] = struct{}{}
				log.Debug().Str("artwork", s.artworkID).Str("client", s.client.id).Msg("subscribed")
			} else {
				if room, ok := h.rooms[s.artworkID]; ok {
					delete(room, s.client)
					if len(room) == 0 {
						delete(h.rooms, s.artworkID)
					}
				}
				log.Debug().Str("artwork", s.artworkID).Str("client", s.client.id).Msg("unsubscribed")
			}

		// client disconnected — remove from all rooms
		case c := <-h.unregCh:
			h.removeClient(c)
		}
	}
}

func (h *Hub) removeClient(c *Client) {
	for artworkID, room := range h.rooms {
		if _, ok := room[c]; ok {
			delete(room, c)
			if len(room) == 0 {
				delete(h.rooms, artworkID)
			}
		}
	}
	close(c.send)
}

// Subscribe enqueues a subscribe/unsubscribe request
func (h *Hub) Subscribe(c *Client, artworkID string) {
	h.subCh <- subscription{client: c, artworkID: artworkID, subscribe: true}
}

func (h *Hub) Unsubscribe(c *Client, artworkID string) {
	h.subCh <- subscription{client: c, artworkID: artworkID, subscribe: false}
}

// Unregister removes a disconnected client from all rooms
func (h *Hub) Unregister(c *Client) {
	h.unregCh <- c
}

// BroadcastPrice fans out a PriceEvent to all clients subscribed to that artwork
func (h *Hub) BroadcastPrice(event PriceEvent) {
	payload, err := json.Marshal(map[string]any{
		"type": "price_update",
		"data": event,
	})
	if err != nil {
		log.Error().Err(err).Msg("failed to marshal price event")
		return
	}
	h.broadcast(event.ArtworkID, payload)
}

// BroadcastGraduated broadcasts a graduation event to the artwork room
func (h *Hub) BroadcastGraduated(event GraduatedEvent) {
	payload, err := json.Marshal(map[string]any{
		"type": "artwork_graduated",
		"data": event,
	})
	if err != nil {
		log.Error().Err(err).Msg("failed to marshal graduated event")
		return
	}
	h.broadcast(event.ArtworkID, payload)
}

func (h *Hub) broadcast(artworkID string, payload []byte) {
	h.mu.RLock()
	room, ok := h.rooms[artworkID]
	h.mu.RUnlock()

	if !ok {
		return // no one is watching this artwork
	}

	sent := 0
	for client := range room {
		select {
		case client.send <- payload:
			sent++
		default:
			// slow client — drop message, do not block broadcaster
			log.Warn().Str("client", client.id).Msg("send buffer full, dropping message")
		}
	}
	log.Debug().Str("artwork", artworkID).Int("clients", sent).Msg("broadcast")
}

// Stats returns current room/client counts for health endpoint
func (h *Hub) Stats() (rooms int, clients int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	rooms = len(h.rooms)
	for _, room := range h.rooms {
		clients += len(room)
	}
	return
}
