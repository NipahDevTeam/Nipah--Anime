package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miruro/backend/extensions"
	"miruro/backend/server"
)

func TestChooseIntegratedPlaybackStreamSourceFallsBackFromBrokenAnimeAV1HLSCandidate(t *testing.T) {
	brokenHLS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, ".m3u8"):
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = io.WriteString(w, "#EXTM3U\nsegment-1.ts\n")
		case strings.HasSuffix(r.URL.Path, ".ts"):
			http.Error(w, "segment unavailable", http.StatusForbidden)
		default:
			http.NotFound(w, r)
		}
	}))
	defer brokenHLS.Close()

	workingMP4 := extensions.StreamSource{
		URL:      "https://cdn.example/video.mp4",
		Quality:  "unknown",
		Language: extensions.LangSpanish,
		Audio:    "sub",
		Referer:  "https://www.mp4upload.com/embed-example.html",
	}

	chosen, ok := chooseIntegratedPlaybackStreamSource("animeav1-es", []extensions.StreamSource{
		{
			URL:      brokenHLS.URL + "/master.m3u8",
			Quality:  "unknown",
			Language: extensions.LangSpanish,
			Audio:    "sub",
			Referer:  "https://player.zilla-networks.com/play/example",
		},
		workingMP4,
	}, server.ProbeMediaProxy)
	if !ok {
		t.Fatal("expected a candidate to be selected")
	}
	if chosen.URL != workingMP4.URL {
		t.Fatalf("expected fallback mp4 candidate, got %#v", chosen)
	}
}

func TestChooseIntegratedPlaybackStreamSourceFallsBackFromBrokenAnimePaheHLSCandidate(t *testing.T) {
	brokenHLS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, ".m3u8"):
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = io.WriteString(w, "#EXTM3U\nsegment-1.ts\n")
		case strings.HasSuffix(r.URL.Path, ".ts"):
			http.Error(w, "segment unavailable", http.StatusForbidden)
		default:
			http.NotFound(w, r)
		}
	}))
	defer brokenHLS.Close()

	workingHLS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, ".m3u8"):
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = io.WriteString(w, "#EXTM3U\nsegment-2.ts\n")
		case strings.HasSuffix(r.URL.Path, ".ts"):
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
	defer workingHLS.Close()

	chosen, ok := chooseIntegratedPlaybackStreamSource("animepahe-en", []extensions.StreamSource{
		{
			URL:      brokenHLS.URL + "/master.m3u8",
			Quality:  "1080p",
			Language: extensions.LangEnglish,
			Audio:    "sub",
			Referer:  "https://kwik.si/e/broken",
		},
		{
			URL:      workingHLS.URL + "/backup.m3u8",
			Quality:  "720p",
			Language: extensions.LangEnglish,
			Audio:    "sub",
			Referer:  "https://kwik.si/e/working",
		},
	}, server.ProbeMediaProxy)
	if !ok {
		t.Fatal("expected a candidate to be selected")
	}
	if chosen.URL != workingHLS.URL+"/backup.m3u8" {
		t.Fatalf("expected fallback hls candidate, got %#v", chosen)
	}
	if chosen.Referer != "https://kwik.si/e/working" {
		t.Fatalf("expected referer to follow the selected candidate, got %#v", chosen)
	}
}
