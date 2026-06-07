// hub/client.go
// One Client per WebSocket connection.
//
// Each client has:
//   - readPump goroutine: reads messages from browser (subscribe/unsubscribe)
//   - writePump goroutine: writes broadcast messages to browser
//
// Pattern: 1 goroutine reads, 1 goroutine writes — gorilla/websocket is not concurrent-safe.

package hub

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10 // must be < pongWait
	maxMessageSize = 512                  // bytes — client messages are small
	sendBufSize    = 256                  // outbound message buffer per client
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Origin validation handled at nginx/gateway level
		// In production: check against ALLOWED_ORIGINS env
		return true
	},
}

// ClientMessage is the JSON structure sent from browser to server
type ClientMessage struct {
	Action    string `json:"action"`     // "subscribe" | "unsubscribe" | "ping"
	ArtworkID string `json:"artwork_id"` // required for subscribe/unsubscribe
}

// Client represents a single WebSocket connection
type Client struct {
	id   string
	hub  *Hub
	conn *websocket.Conn
	send chan []byte // outbound messages
}

func newID() string {
	return fmt.Sprintf("%08x", rand.Uint32())
}

// ServeWS upgrades the HTTP connection to WebSocket and starts the client pumps.
// Called from HTTP handler.
func ServeWS(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Error().Err(err).Msg("websocket upgrade failed")
		return
	}

	client := &Client{
		id:   newID(),
		hub:  hub,
		conn: conn,
		send: make(chan []byte, sendBufSize),
	}

	log.Info().Str("client", client.id).Str("remote", r.RemoteAddr).Msg("new connection")

	// Start pumps — each runs in its own goroutine
	go client.writePump()
	go client.readPump()
}

// readPump reads client messages (subscribe/unsubscribe) in a loop.
// When done (browser closed tab), it unregisters and closes the connection.
func (c *Client) readPump() {
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close()
		log.Info().Str("client", c.id).Msg("disconnected")
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err,
				websocket.CloseGoingAway,
				websocket.CloseAbnormalClosure,
			) {
				log.Warn().Str("client", c.id).Err(err).Msg("unexpected close")
			}
			return
		}

		var msg ClientMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Warn().Str("client", c.id).Err(err).Msg("invalid message")
			continue
		}

		switch msg.Action {
		case "subscribe":
			if msg.ArtworkID == "" {
				continue
			}
			c.hub.Subscribe(c, msg.ArtworkID)

		case "unsubscribe":
			if msg.ArtworkID == "" {
				continue
			}
			c.hub.Unsubscribe(c, msg.ArtworkID)

		case "ping":
			// client-level keepalive (in addition to WS pings)
			c.send <- []byte(`{"type":"pong"}`)
		}
	}
}

// writePump drains the send channel and writes to the WebSocket connection.
// Also sends periodic pings so the browser knows the connection is alive.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel — send close frame
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Flush any queued messages in the same write (batch optimisation)
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte("\n"))
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
