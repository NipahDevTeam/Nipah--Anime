package server

import (
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

func TestBrowserMediaContentTypeTreatsZillaHTMLSegmentsAsVideoMP4(t *testing.T) {
	got := browserMediaContentType(
		"https://player.zilla-networks.com/segs/12f833f98e1249f9e50e6ab3f2eaf476/000.html",
		"text/html",
	)
	if got != "video/mp4" {
		t.Fatalf("expected Zilla html segment to be normalized as video/mp4, got %q", got)
	}
}
