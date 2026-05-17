package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestHandleMediaProxyForwardsCookieToUpstreamMedia(t *testing.T) {
	const expectedCookie = "session=abc123"
	const expectedBody = "video-bytes"

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := strings.TrimSpace(r.Header.Get("Cookie")); got != expectedCookie {
			http.Error(w, "missing cookie", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = io.WriteString(w, expectedBody)
	}))
	defer upstream.Close()

	params := url.Values{}
	params.Set("url", upstream.URL+"/episode.mp4")
	params.Set("referer", "https://provider.example/watch")
	params.Set("cookie", expectedCookie)

	req := httptest.NewRequest(http.MethodGet, "/proxy/media?"+params.Encode(), nil)
	rr := httptest.NewRecorder()

	(&Server{}).handleMediaProxy(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %q", rr.Code, rr.Body.String())
	}
	if body := rr.Body.String(); body != expectedBody {
		t.Fatalf("expected body %q, got %q", expectedBody, body)
	}
}

func TestHandleMediaProxyRewritesHLSManifestWithCookie(t *testing.T) {
	const expectedCookie = "session=abc123"

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := strings.TrimSpace(r.Header.Get("Cookie")); got != expectedCookie {
			http.Error(w, "missing cookie", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		_, _ = io.WriteString(w, "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.key\"\nsegment-1.ts\n")
	}))
	defer upstream.Close()

	params := url.Values{}
	params.Set("url", upstream.URL+"/master.m3u8")
	params.Set("referer", "https://provider.example/watch")
	params.Set("cookie", expectedCookie)

	req := httptest.NewRequest(http.MethodGet, "/proxy/media?"+params.Encode(), nil)
	rr := httptest.NewRecorder()

	(&Server{}).handleMediaProxy(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %q", rr.Code, rr.Body.String())
	}

	body := rr.Body.String()
	if !strings.Contains(body, "cookie="+url.QueryEscape(expectedCookie)) {
		t.Fatalf("expected rewritten manifest to preserve cookie, got %q", body)
	}
	if !strings.Contains(body, "/proxy/media?") {
		t.Fatalf("expected manifest entries to be rewritten through proxy, got %q", body)
	}
	if strings.Contains(body, "http://localhost:43212/") {
		t.Fatalf("expected rewritten manifest to use the internal loopback proxy base url, got %q", body)
	}
	if !strings.Contains(body, "http://127.0.0.1:43212/proxy/media?") {
		t.Fatalf("expected rewritten manifest to use 127.0.0.1 proxy urls, got %q", body)
	}
}

func TestHandleMediaProxyRewritesNestedHLSRequestsWithOriginalReferer(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		_, _ = io.WriteString(w, "#EXTM3U\nsegment-1-v1-a1.jpg\n")
	}))
	defer upstream.Close()

	originalReferer := "https://kwik.cx/e/example"
	params := url.Values{}
	params.Set("url", upstream.URL+"/master.m3u8")
	params.Set("referer", originalReferer)

	req := httptest.NewRequest(http.MethodGet, "/proxy/media?"+params.Encode(), nil)
	rr := httptest.NewRecorder()

	(&Server{}).handleMediaProxy(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %q", rr.Code, rr.Body.String())
	}

	lines := strings.Split(strings.TrimSpace(rr.Body.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 manifest lines, got %d in %q", len(lines), rr.Body.String())
	}

	segmentURL, err := url.Parse(lines[1])
	if err != nil {
		t.Fatalf("parse rewritten segment url: %v", err)
	}
	if got := segmentURL.Query().Get("referer"); got != originalReferer {
		t.Fatalf("expected nested segment referer to preserve original embed referer, got %q", got)
	}
}

func TestProbeMediaProxyUsesOriginalRefererForHLSFirstSegmentProbe(t *testing.T) {
	const originalReferer = "https://kwik.cx/e/example"

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, ".m3u8"):
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = io.WriteString(w, "#EXTM3U\nsegment-1.ts\n")
		case strings.HasSuffix(r.URL.Path, ".ts"):
			if got := strings.TrimSpace(r.Header.Get("Referer")); got != originalReferer {
				http.Error(w, "bad referer", http.StatusForbidden)
				return
			}
			w.Header().Set("Content-Type", "video/mp2t")
			w.Header().Set("Accept-Ranges", "bytes")
			if strings.TrimSpace(r.Header.Get("Range")) != "" {
				w.Header().Set("Content-Range", "bytes 0-0/1")
				w.WriteHeader(http.StatusPartialContent)
				_, _ = io.WriteString(w, "x")
				return
			}
			_, _ = io.WriteString(w, "segment-data")
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	result, err := ProbeMediaProxy(upstream.URL+"/master.m3u8", originalReferer, "")
	if err != nil {
		t.Fatalf("probe media proxy: %v", err)
	}
	if result.Classification != "provider-compatible" {
		t.Fatalf("expected provider-compatible classification, got %q (%s)", result.Classification, result.ClassificationReason)
	}
	if result.FirstSegmentStatus != http.StatusPartialContent {
		t.Fatalf("expected first segment status 206, got %d", result.FirstSegmentStatus)
	}
}

func TestProbeMediaProxyUsesRangeProbeForDirectMediaWithoutFullBodyFetch(t *testing.T) {
	const originalReferer = "https://animeheaven.me/gate.php"
	rangeRequests := 0
	fullRequests := 0

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := strings.TrimSpace(r.Header.Get("Referer")); got != originalReferer {
			http.Error(w, "bad referer", http.StatusForbidden)
			return
		}
		if strings.TrimSpace(r.Header.Get("Range")) == "bytes=0-0" {
			rangeRequests++
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Accept-Ranges", "bytes")
			w.Header().Set("Content-Range", "bytes 0-0/1234")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = io.WriteString(w, "x")
			return
		}
		fullRequests++
		http.Error(w, "unexpected full fetch", http.StatusTeapot)
	}))
	defer upstream.Close()

	result, err := ProbeMediaProxy(upstream.URL+"/video.mp4", originalReferer, "")
	if err != nil {
		t.Fatalf("probe media proxy: %v", err)
	}
	if result.Classification != "provider-compatible" {
		t.Fatalf("expected provider-compatible classification, got %q (%s)", result.Classification, result.ClassificationReason)
	}
	if result.RangeProbeStatus != http.StatusPartialContent {
		t.Fatalf("expected range probe status 206, got %d", result.RangeProbeStatus)
	}
	if rangeRequests == 0 {
		t.Fatal("expected direct media probe to use a range request")
	}
	if fullRequests != 0 {
		t.Fatalf("expected no full-body direct media probe, got %d full requests", fullRequests)
	}
}

func TestBrowserMediaContentTypeTreatsZillaHTMLSegmentsAsVideoMP4(t *testing.T) {
	got := browserMediaContentType(
		"https://player.zilla-networks.com/segs/12f833f98e1249f9e50e6ab3f2eaf476/000.html",
		"text/html",
	)
	if got != "video/mp4" {
		t.Fatalf("expected Zilla html segment to be normalized as video/mp4, got %q", got)
	}
}

func TestBrowserMediaContentTypeTreatsAnimePaheJPGSegmentsAsVideoMP2T(t *testing.T) {
	got := browserMediaContentType(
		"https://vault-99.owocdn.top/stream/99/02/example/segment-1-v1-a1.jpg",
		"image/jpeg",
	)
	if got != "video/mp2t" {
		t.Fatalf("expected AnimePahe jpg segment to be normalized as video/mp2t, got %q", got)
	}
}

func TestBrowserMediaContentTypeTreatsHLSKeyFilesAsBinary(t *testing.T) {
	got := browserMediaContentType(
		"https://vault-99.owocdn.top/stream/99/02/example/mon.key",
		"",
	)
	if got != "application/octet-stream" {
		t.Fatalf("expected HLS key file to be normalized as application/octet-stream, got %q", got)
	}
}

func TestHandleIntegratedPlaybackDiagnosticsReturnsEntries(t *testing.T) {
	server := &Server{
		getIntegratedPlaybackDiagnostics: func() []map[string]interface{} {
			return []map[string]interface{}{
				{"event": "session_start", "source_label": "AnimePahe"},
				{"event": "hls_error", "error_type": "mediaError"},
			}
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/debug/integrated-playback-diagnostics", nil)
	rr := httptest.NewRecorder()

	server.handleIntegratedPlaybackDiagnostics(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %q", rr.Code, rr.Body.String())
	}

	var payload struct {
		Count       int                      `json:"count"`
		Diagnostics []map[string]interface{} `json:"diagnostics"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode diagnostics payload: %v", err)
	}
	if payload.Count != 2 {
		t.Fatalf("expected count 2, got %d", payload.Count)
	}
	if len(payload.Diagnostics) != 2 {
		t.Fatalf("expected 2 diagnostics, got %d", len(payload.Diagnostics))
	}
}

func TestHandleClearIntegratedPlaybackDiagnosticsClearsEntries(t *testing.T) {
	cleared := false
	server := &Server{
		clearIntegratedPlaybackDiagnostics: func() {
			cleared = true
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/debug/integrated-playback-diagnostics/clear", nil)
	rr := httptest.NewRecorder()

	server.handleClearIntegratedPlaybackDiagnostics(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %q", rr.Code, rr.Body.String())
	}
	if !cleared {
		t.Fatal("expected clear callback to run")
	}
}

func TestHandleTranscodeProxyReturnsServiceUnavailableWhenFFmpegMissing(t *testing.T) {
	originalFinder := findFFmpegBinary
	findFFmpegBinary = func(string) (string, error) {
		return "", errors.New("missing")
	}
	defer func() {
		findFFmpegBinary = originalFinder
	}()

	params := url.Values{}
	params.Set("url", "https://example.com/master.m3u8")
	req := httptest.NewRequest(http.MethodGet, "/proxy/transcode?"+params.Encode(), nil)
	rr := httptest.NewRecorder()

	server := &Server{}
	server.handleTranscodeProxy(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503, got %d with body %q", rr.Code, rr.Body.String())
	}
}

func TestTranscodeProxyURLPreservesRefererAndCookie(t *testing.T) {
	rawURL := "https://vault-16.owocdn.top/stream/example/uwu.m3u8"
	value := TranscodeProxyURL(rawURL, "https://kwik.cx/e/example", "session=abc123")
	if !strings.Contains(value, "/proxy/transcode?") {
		t.Fatalf("expected transcode proxy url, got %q", value)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatalf("parse transcode proxy url: %v", err)
	}
	if got := parsed.Query().Get("url"); got != rawURL {
		t.Fatalf("expected raw url %q, got %q", rawURL, got)
	}
	if got := parsed.Query().Get("referer"); got != "https://kwik.cx/e/example" {
		t.Fatalf("expected referer to be preserved, got %q", got)
	}
	if got := parsed.Query().Get("cookie"); got != "session=abc123" {
		t.Fatalf("expected cookie to be preserved, got %q", got)
	}
}
