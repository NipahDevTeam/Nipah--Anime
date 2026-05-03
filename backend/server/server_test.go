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
