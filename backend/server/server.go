package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/pprof"
	"net/url"
	"regexp"
	"strings"
	"time"

	"miruro/backend/db"
	"miruro/backend/extensions/sourceaccess"
	"miruro/backend/library"
	"miruro/backend/logger"
	"miruro/backend/metadata"
	torrentbackend "miruro/backend/torrent"
)

var log = logger.For("Server")

// Server is the internal HTTP server used for extension IPC and
// any functionality that needs a proper REST API on localhost.
type Server struct {
	db            *db.Database
	library       *library.Manager
	metadata      *metadata.Manager
	torrentStream *torrentbackend.StreamManager
	mux           *http.ServeMux
	debug         bool
}

type MediaProxyProbeResult struct {
	RawURL               string `json:"raw_url"`
	Referer              string `json:"referer"`
	ProxyURL             string `json:"proxy_url"`
	UpstreamStatus       int    `json:"upstream_status"`
	UpstreamContentType  string `json:"upstream_content_type"`
	IsHLS                bool   `json:"is_hls"`
	ManifestRewritten    bool   `json:"manifest_rewritten"`
	ManifestLineCount    int    `json:"manifest_line_count"`
	FirstSegmentURL      string `json:"first_segment_url,omitempty"`
	FirstSegmentStatus   int    `json:"first_segment_status,omitempty"`
	FirstSegmentType     string `json:"first_segment_type,omitempty"`
	RangeProbeStatus     int    `json:"range_probe_status,omitempty"`
	RangeProbeType       string `json:"range_probe_type,omitempty"`
	AcceptRanges         string `json:"accept_ranges,omitempty"`
	ContentRange         string `json:"content_range,omitempty"`
	Classification       string `json:"classification"`
	ClassificationReason string `json:"classification_reason"`
}

type responseData struct {
	status      int
	contentType string
	body        []byte
	headers     http.Header
}

// New creates a new Server instance.
func New(database *db.Database, lib *library.Manager, meta *metadata.Manager, torrentStream *torrentbackend.StreamManager, debug bool) *Server {
	s := &Server{
		db:            database,
		library:       lib,
		metadata:      meta,
		torrentStream: torrentStream,
		mux:           http.NewServeMux(),
		debug:         debug,
	}
	s.registerRoutes()
	return s
}

func (s *Server) SetTorrentStream(torrentStream *torrentbackend.StreamManager) {
	s.torrentStream = torrentStream
}

// Start begins listening on the given address.
func (s *Server) Start(addr string) {
	log.Info().Str("addr", addr).Msg("internal server listening")
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
		log.Error().Err(err).Msg("server error")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

func (s *Server) registerRoutes() {
	// Health check
	s.mux.HandleFunc("/health", s.handleHealth)
	if s.debug {
		s.registerDebugRoutes()
	}

	// Image proxy — lets the webview load external images that block CORS
	s.mux.HandleFunc("/proxy/image", s.handleImageProxy)
	s.mux.HandleFunc("/proxy/media", s.handleMediaProxy)
	s.mux.HandleFunc("/torrent/stream", s.handleTorrentStream)

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

func (s *Server) registerDebugRoutes() {
	s.mux.HandleFunc("/debug/pprof/", pprof.Index)
	s.mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	s.mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	s.mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	s.mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
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

var mediaProxyClient = &http.Client{
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

func (s *Server) handleMediaProxy(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("url")
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

	req, err := http.NewRequest(http.MethodGet, raw, nil)
	if err != nil {
		http.Error(w, "request error", http.StatusBadGateway)
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Referer", referer)
	if accept := strings.TrimSpace(r.Header.Get("Accept")); accept != "" {
		req.Header.Set("Accept", accept)
	}
	if byteRange := strings.TrimSpace(r.Header.Get("Range")); byteRange != "" {
		req.Header.Set("Range", byteRange)
	}

	resp, err := mediaProxyClient.Do(req)
	if err != nil {
		http.Error(w, "fetch error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if isM3U8Content(raw, contentType) {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			http.Error(w, "read error", http.StatusBadGateway)
			return
		}
		manifest := rewriteM3U8Manifest(string(body), parsed)
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write([]byte(manifest))
		return
	}

	contentType = browserMediaContentType(raw, contentType)
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Content-Disposition", "inline")
	if contentLength := strings.TrimSpace(resp.Header.Get("Content-Length")); contentLength != "" {
		w.Header().Set("Content-Length", contentLength)
	}
	if contentRange := strings.TrimSpace(resp.Header.Get("Content-Range")); contentRange != "" {
		w.Header().Set("Content-Range", contentRange)
	}
	if acceptRanges := strings.TrimSpace(resp.Header.Get("Accept-Ranges")); acceptRanges != "" {
		w.Header().Set("Accept-Ranges", acceptRanges)
	}
	if etag := strings.TrimSpace(resp.Header.Get("ETag")); etag != "" {
		w.Header().Set("ETag", etag)
	}
	if lastModified := strings.TrimSpace(resp.Header.Get("Last-Modified")); lastModified != "" {
		w.Header().Set("Last-Modified", lastModified)
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (s *Server) handleTorrentStream(w http.ResponseWriter, r *http.Request) {
	if s.torrentStream == nil {
		http.Error(w, "torrent streaming unavailable", http.StatusServiceUnavailable)
		return
	}
	sessionID := strings.TrimSpace(r.URL.Query().Get("id"))
	if sessionID == "" {
		http.Error(w, "missing torrent session id", http.StatusBadRequest)
		return
	}
	if err := s.torrentStream.StreamHTTP(w, r, sessionID); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
	}
}

var hlsURIAttr = regexp.MustCompile(`URI="([^"]+)"`)

func isM3U8Content(rawURL, contentType string) bool {
	lowerURL := strings.ToLower(rawURL)
	lowerCT := strings.ToLower(contentType)
	return strings.Contains(lowerURL, ".m3u8") ||
		strings.Contains(lowerCT, "application/vnd.apple.mpegurl") ||
		strings.Contains(lowerCT, "application/x-mpegurl")
}

func browserMediaContentType(rawURL, contentType string) string {
	lowerURL := strings.ToLower(strings.TrimSpace(rawURL))
	lowerCT := strings.ToLower(strings.TrimSpace(contentType))
	switch {
	case strings.Contains(lowerURL, ".m3u8"), strings.Contains(lowerCT, "application/vnd.apple.mpegurl"), strings.Contains(lowerCT, "application/x-mpegurl"):
		return "application/vnd.apple.mpegurl"
	case strings.Contains(lowerURL, ".mp4"), strings.Contains(lowerCT, "application/octet-stream"), lowerCT == "":
		return "video/mp4"
	case strings.Contains(lowerURL, ".webm"):
		return "video/webm"
	case strings.Contains(lowerURL, ".m4v"):
		return "video/x-m4v"
	default:
		return contentType
	}
}

func rewriteM3U8Manifest(manifest string, base *url.URL) string {
	lines := strings.Split(manifest, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "#") {
			lines[i] = hlsURIAttr.ReplaceAllStringFunc(line, func(match string) string {
				parts := hlsURIAttr.FindStringSubmatch(match)
				if len(parts) != 2 {
					return match
				}
				resolved := resolveManifestRef(base, parts[1])
				return fmt.Sprintf(`URI="%s"`, mediaProxyURL(resolved, base.String()))
			})
			continue
		}
		lines[i] = mediaProxyURL(resolveManifestRef(base, trimmed), base.String())
	}
	return strings.Join(lines, "\n")
}

func resolveManifestRef(base *url.URL, ref string) string {
	u, err := url.Parse(strings.TrimSpace(ref))
	if err != nil {
		return ref
	}
	return base.ResolveReference(u).String()
}

func mediaProxyURL(rawURL, referer string) string {
	params := url.Values{}
	params.Set("url", rawURL)
	if referer != "" {
		params.Set("referer", referer)
	}
	return "http://localhost:43212/proxy/media?" + params.Encode()
}

func ProbeMediaProxy(rawURL, referer string) (*MediaProxyProbeResult, error) {
	parsed, refererValue, err := parseMediaProxyInputs(rawURL, referer)
	if err != nil {
		return nil, err
	}

	resp, err := fetchMediaProxyResponse(rawURL, refererValue, "", "")
	if err != nil {
		return nil, err
	}

	result := &MediaProxyProbeResult{
		RawURL:              rawURL,
		Referer:             refererValue,
		ProxyURL:            mediaProxyURL(rawURL, refererValue),
		UpstreamStatus:      resp.status,
		UpstreamContentType: resp.contentType,
		IsHLS:               isM3U8Content(rawURL, resp.contentType),
		AcceptRanges:        strings.TrimSpace(resp.headers.Get("Accept-Ranges")),
		ContentRange:        strings.TrimSpace(resp.headers.Get("Content-Range")),
	}

	if resp.status >= http.StatusBadRequest {
		result.Classification = "proxy-broken"
		result.ClassificationReason = fmt.Sprintf("upstream returned HTTP %d", resp.status)
		return result, nil
	}

	if result.IsHLS {
		manifest := rewriteM3U8Manifest(string(resp.body), parsed)
		result.ManifestLineCount = len(strings.Split(manifest, "\n"))
		result.ManifestRewritten = strings.Contains(manifest, "/proxy/media?")

		firstSegmentRaw, firstSegmentProxy := firstPlayableManifestLine(manifest)
		result.FirstSegmentURL = firstSegmentProxy
		if firstSegmentRaw != "" {
			segmentResp, segErr := fetchMediaProxyResponse(firstSegmentRaw, parsed.String(), "bytes=0-0", "video/*,*/*;q=0.8")
			if segErr == nil {
				result.FirstSegmentStatus = segmentResp.status
				result.FirstSegmentType = segmentResp.contentType
			}
		}

		switch {
		case !result.ManifestRewritten:
			result.Classification = "proxy-broken"
			result.ClassificationReason = "manifest was not rewritten through /proxy/media"
		case result.FirstSegmentStatus >= http.StatusBadRequest:
			result.Classification = "proxy-broken"
			result.ClassificationReason = fmt.Sprintf("first HLS segment returned HTTP %d", result.FirstSegmentStatus)
		default:
			result.Classification = "provider-compatible"
			result.ClassificationReason = "manifest and first segment look browser-playable"
		}
		return result, nil
	}

	rangeResp, rangeErr := fetchMediaProxyResponse(rawURL, refererValue, "bytes=0-0", "video/*,*/*;q=0.8")
	if rangeErr == nil {
		result.RangeProbeStatus = rangeResp.status
		result.RangeProbeType = rangeResp.contentType
		if result.AcceptRanges == "" {
			result.AcceptRanges = strings.TrimSpace(rangeResp.headers.Get("Accept-Ranges"))
		}
		if result.ContentRange == "" {
			result.ContentRange = strings.TrimSpace(rangeResp.headers.Get("Content-Range"))
		}
	}

	switch {
	case result.RangeProbeStatus >= http.StatusBadRequest:
		result.Classification = "proxy-broken"
		result.ClassificationReason = fmt.Sprintf("range probe returned HTTP %d", result.RangeProbeStatus)
	case result.RangeProbeStatus == http.StatusPartialContent || result.AcceptRanges != "" || result.ContentRange != "":
		result.Classification = "provider-compatible"
		result.ClassificationReason = "direct media responds with browser-compatible range semantics"
	default:
		result.Classification = "provider-compatible"
		result.ClassificationReason = "direct media responded successfully but range support was inconclusive"
	}

	return result, nil
}

func parseMediaProxyInputs(rawURL, referer string) (*url.URL, string, error) {
	parsed, err := url.ParseRequestURI(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, "", fmt.Errorf("invalid media url")
	}
	if strings.TrimSpace(referer) == "" {
		referer = parsed.Scheme + "://" + parsed.Host + "/"
	}
	return parsed, strings.TrimSpace(referer), nil
}

func fetchMediaProxyResponse(rawURL, referer, byteRange, accept string) (*responseData, error) {
	_, refererValue, err := parseMediaProxyInputs(rawURL, referer)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Referer", refererValue)
	if strings.TrimSpace(accept) != "" {
		req.Header.Set("Accept", strings.TrimSpace(accept))
	}
	if strings.TrimSpace(byteRange) != "" {
		req.Header.Set("Range", strings.TrimSpace(byteRange))
	}

	resp, err := mediaProxyClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return &responseData{
		status:      resp.StatusCode,
		contentType: resp.Header.Get("Content-Type"),
		body:        body,
		headers:     resp.Header.Clone(),
	}, nil
}

func firstPlayableManifestLine(manifest string) (string, string) {
	for _, line := range strings.Split(manifest, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.Contains(trimmed, "/proxy/media?") {
			if parsed, err := url.Parse(trimmed); err == nil {
				rawURL := parsed.Query().Get("url")
				return rawURL, trimmed
			}
		}
		return trimmed, trimmed
	}
	return "", ""
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
