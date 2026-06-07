// redis/subscriber.go
// Subscribes to Redis pub/sub channels and forwards events to the Hub.
//
// Channels (same as NestJS redis.constants.ts):
//   artwork:price:updated   → PriceEvent  → Hub.BroadcastPrice
//   artwork:graduated       → GraduatedEvent → Hub.BroadcastGraduated
//
// Reconnect: go-redis automatically reconnects on network failures.

package redis

import (
	"context"
	"encoding/json"
	"time"

	goredis "github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/artcurve/ws-hub/hub"
)

const (
	channelPriceUpdated    = "artwork:price:updated"
	channelArtworkGraduated = "artwork:graduated"
)

// Subscriber holds the Redis client and a reference to the hub
type Subscriber struct {
	client *goredis.Client
	hub    *hub.Hub
}

func New(addr, password string, db int, h *hub.Hub) *Subscriber {
	rdb := goredis.NewClient(&goredis.Options{
		Addr:         addr,
		Password:     password,
		DB:           db,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 5 * time.Second,
		// Connection pool — tune based on load
		PoolSize:    10,
		MinIdleConns: 2,
	})
	return &Subscriber{client: rdb, hub: h}
}

// Run blocks and processes pub/sub messages.
// Call in a goroutine: go sub.Run(ctx)
func (s *Subscriber) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("redis subscriber shutting down")
			return
		default:
		}

		if err := s.subscribe(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Error().Err(err).Msg("redis subscriber error — retrying in 3s")
			time.Sleep(3 * time.Second)
		}
	}
}

func (s *Subscriber) subscribe(ctx context.Context) error {
	pubsub := s.client.Subscribe(ctx,
		channelPriceUpdated,
		channelArtworkGraduated,
	)
	defer pubsub.Close()

	// Wait for confirmation
	if _, err := pubsub.Receive(ctx); err != nil {
		return err
	}

	log.Info().
		Str("channels", channelPriceUpdated+", "+channelArtworkGraduated).
		Msg("redis pub/sub connected")

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return nil

		case msg, ok := <-ch:
			if !ok {
				return nil // channel closed — will reconnect
			}
			s.dispatch(msg)
		}
	}
}

func (s *Subscriber) dispatch(msg *goredis.Message) {
	switch msg.Channel {

	case channelPriceUpdated:
		var event hub.PriceEvent
		if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
			log.Error().Err(err).Str("raw", msg.Payload).Msg("failed to parse price event")
			return
		}
		log.Debug().
			Str("artwork", event.ArtworkID).
			Str("price", event.CurrentPrice).
			Msg("price event received")
		s.hub.BroadcastPrice(event)

	case channelArtworkGraduated:
		var event hub.GraduatedEvent
		if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
			log.Error().Err(err).Msg("failed to parse graduated event")
			return
		}
		log.Info().Str("artwork", event.ArtworkID).Msg("graduation event received")
		s.hub.BroadcastGraduated(event)

	default:
		log.Warn().Str("channel", msg.Channel).Msg("unknown channel")
	}
}

// Ping checks Redis connectivity (used by health endpoint)
func (s *Subscriber) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}
