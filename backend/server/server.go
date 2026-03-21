package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"miruro/backend/db"
	"miruro/backend/extensions/sourceaccess"
	"miruro/backend/library"
	"miruro/backend/metadata"
)

// Server is the internal HTTP server used for extension IPC and
// any functionality that needs a proper REST API on localhost.
type Server struct {
	db       *db.Database
	library  *library.Manager
	metadata *metadata.Manager
	mux      *http.ServeMux
}

// New creates a new Server instance.
func New(database *db.Database, lib *library.Manager, meta *metadata.Manager) *Server {
	s := &Server{
		db:       database,
		library:  lib,
		metadata: meta,
		mux:      http.NewServeMux(),
	}
	s.registerRoutes()
	return s
}

// Start begins listening on the given address.
func (s *Server) Start(addr string) {
	fmt.Printf("Nipah! internal server listening on %s\n", addr)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		s.mux.ServeHTTP(w, r)
	})
	if err := http.ListenAndServe(addr, handler); err != nil {
		fmt.Printf("Server error: %v\n", err)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

func (s *Server) registerRoutes() {
	// Health check
	s.mux.HandleFunc("/health", s.handleHealth)

	// Image proxy — lets the webview load external images that block CORS
	s.mux.HandleFunc("/proxy/image", s.handleImageProxy)

	// Library
	s.mux.HandleFunc("/api/library/stats", s.handleLibraryStats)
	s.mux.HandleFunc("/api/library/anime", s.handleAnimeList)
	s.mux.HandleFunc("/api/library/manga", s.handleMangaList)
	s.mux.HandleFunc("/api/library/scan", s.handleScan)

	// Metadata
	s.mux.HandleFunc("/api/metadata/anilist/search", s.handleAniListSearch)
	s.mux.HandleFunc("/api/metadata/mangadex/search", s.handleMangaDexSearch)

	// Settings
	s.mux.HandleFunc("/api/settings", s.handleSettings)
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.json(w, map[string]string{"status": "ok", "version": "0.1.0"})
}

func (s *Server) handleLibraryStats(w http.ResponseWriter, r *http.Request) {
	s.json(w, s.library.GetStats())
}

func (s *Server) handleAnimeList(w http.ResponseWriter, r *http.Request) {
	list, err := s.library.GetAnimeList()
	if err != nil {
		s.error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.json(w, list)
}

func (s *Server) handleMangaList(w http.ResponseWriter, r *http.Request) {
	list, err := s.library.GetMangaList()
	if err != nil {
		s.error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.json(w, list)
}

func (s *Server) handleScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	result, err := s.library.Scan(body.Path)
	if err != nil {
		s.error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.json(w, result)
}

func (s *Server) handleAniListSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	lang := r.URL.Query().Get("lang")
	if lang == "" {
		lang = "es"
	}

	result, err := s.metadata.SearchAniList(query, lang)
	if err != nil {
		s.error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.json(w, result)
}

func (s *Server) handleMangaDexSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	lang := r.URL.Query().Get("lang")
	if lang == "" {
		lang = "es"
	}

	result, err := s.metadata.SearchMangaDex(query, lang)
	if err != nil {
		s.error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.json(w, result)
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := s.db.Conn().Query(`SELECT key, value FROM settings`)
		if err != nil {
			s.error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		settings := make(map[string]string)
		for rows.Next() {
			var k, v string
			if err := rows.Scan(&k, &v); err == nil {
				settings[k] = v
			}
		}
		s.json(w, settings)

	case http.MethodPatch:
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			s.error(w, "invalid body", http.StatusBadRequest)
			return
		}
		for k, v := range body {
			_, _ = s.db.Conn().Exec(
				`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
				k, v,
			)
		}
		s.json(w, map[string]string{"status": "updated"})

	default:
		s.error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Image proxy
// Wails' webview blocks loading images from external origins.
// The frontend requests /proxy/image?url=... and Go fetches + forwards it.
// Only allows http/https image URLs.
// ─────────────────────────────────────────────────────────────────────────────

var proxyClient = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		MaxIdleConns:        32,
		MaxIdleConnsPerHost: 16,
		IdleConnTimeout:     90 * time.Second,
	},
}

func (s *Server) handleImageProxy(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("url")
	sourceID := strings.TrimSpace(r.URL.Query().Get("source"))
	referer := strings.TrimSpace(r.URL.Query().Get("referer"))
	if raw == "" {
		http.Error(w, "missing url", http.StatusBadRequest)
		return
	}

	parsed, err := url.ParseRequestURI(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}

	if referer == "" {
		referer = parsed.Scheme + "://" + parsed.Host + "/"
	}

	var (
		body        []byte
		contentType string
		statusCode  int
	)

	if sourceID != "" {
		if _, ok := sourceaccess.GetProfile(sourceID); !ok {
			sourceID = ""
		}
	}

	if sourceID != "" {
		var err error
		body, contentType, err = sourceaccess.FetchBytes(sourceID, raw, sourceaccess.RequestOptions{Referer: referer})
		if err != nil {
			http.Error(w, "fetch error", http.StatusBadGateway)
			return
		}
		statusCode = http.StatusOK
	} else {
		req, err := http.NewRequest("GET", raw, nil)
		if err != nil {
			http.Error(w, "request error", http.StatusBadGateway)
			return
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
		req.Header.Set("Referer", referer)

		resp, err := proxyClient.Do(req)
		if err != nil {
			http.Error(w, "fetch error", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		body, err = io.ReadAll(resp.Body)
		if err != nil {
			http.Error(w, "read error", http.StatusBadGateway)
			return
		}
		contentType = resp.Header.Get("Content-Type")
		statusCode = resp.StatusCode
	}

	w.Header().Set("Content-Type", sourceaccess.ContentTypeOrJPEG(contentType, body))
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(statusCode)
	_, _ = w.Write(body)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func (s *Server) json(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(data)
}

func (s *Server) error(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
