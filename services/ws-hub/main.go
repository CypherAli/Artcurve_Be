// main.go — ArtCurve WebSocket Hub (Go)
//
// Replaces NestJS PriceGateway for WebSocket fan-out.
// NestJS still handles REST, auth, and Redis publishing.
//
// Architecture:
//   Browser ─── WS /ws ──→ Go Hub ←── Redis sub ←── NestJS publishes
//
// Env vars:
//   PORT           default 8080
//   REDIS_URL      default redis://localhost:6379
//   REDIS_PASSWORD default ""
//   REDIS_DB       default 0
//   ALLOWED_ORIGINS comma-separated, e.g. https://artcurve-fe.vercel.app

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/artcurve/ws-hub/hub"
	redissub "github.com/artcurve/ws-hub/redis"
)

func main() {
	// ── Config ──────────────────────────────────────────────────────────────
	_ = godotenv.Load() // load .env if present (dev)

	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if os.Getenv("LOG_PRETTY") == "true" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})
	}

	port        := getenv("PORT", "8080")
	redisURL    := getenv("REDIS_URL", "localhost:6379")
	redisPass   := getenv("REDIS_PASSWORD", "")
	redisDB, _  := strconv.Atoi(getenv("REDIS_DB", "0"))

	// ── Hub ──────────────────────────────────────────────────────────────────
	h := hub.New()
	go h.Run() // single goroutine processes all room mutations

	// ── Redis subscriber ─────────────────────────────────────────────────────
	sub := redissub.New(redisURL, redisPass, redisDB, h)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go sub.Run(ctx) // reconnects automatically on failure

	// ── HTTP server ──────────────────────────────────────────────────────────
	mux := http.NewServeMux()

	// WebSocket endpoint — clients connect here
	// Protocol:
	//   client → {"action":"subscribe","artwork_id":"<uuid>"}
	//   server → {"type":"price_update","data":{...PriceEvent}}
	//   server → {"type":"artwork_graduated","data":{...}}
	//   client → {"action":"unsubscribe","artwork_id":"<uuid>"}
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(h, w, r)
	})

	// Health check — used by Railway/Render/Docker healthcheck
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		rooms, clients := h.Stats()

		pingErr := sub.Ping(r.Context())
		redisOK := pingErr == nil

		status := "ok"
		code   := http.StatusOK
		if !redisOK {
			status = "degraded"
			code   = http.StatusServiceUnavailable
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		json.NewEncoder(w).Encode(map[string]any{
			"status":       status,
			"redis":        redisOK,
			"active_rooms": rooms,
			"active_clients": clients,
			"uptime":       time.Since(startTime).String(),
		})
	})

	// Metrics — basic Prometheus-compatible text (optional, add prom client later)
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		rooms, clients := h.Stats()
		fmt.Fprintf(w,
			"# HELP artcurve_ws_rooms Active artwork rooms\n"+
				"artcurve_ws_rooms %d\n"+
				"# HELP artcurve_ws_clients Connected WebSocket clients\n"+
				"artcurve_ws_clients %d\n",
			rooms, clients,
		)
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      withCORS(mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 0, // WebSocket connections are long-lived
		IdleTimeout:  120 * time.Second,
	}

	// ── Graceful shutdown ────────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info().Str("port", port).Msg("artcurve ws-hub started")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	<-quit
	log.Info().Msg("shutting down gracefully...")
	cancel() // stop Redis subscriber

	shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutCancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		log.Error().Err(err).Msg("forced shutdown")
	}
	log.Info().Msg("bye")
}

var startTime = time.Now()

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// withCORS adds permissive CORS headers.
// In production, restrict to ALLOWED_ORIGINS env var.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		allowed := getenv("ALLOWED_ORIGINS", "*")
		w.Header().Set("Access-Control-Allow-Origin", allowed)
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
