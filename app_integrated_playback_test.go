package main

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"miruro/backend/db"
	"miruro/backend/extensions"
)

type stubAnimePlaybackSource struct {
	stubAnimeSource
	episodes []extensions.Episode
	streams  []extensions.StreamSource
}

func (s *stubAnimePlaybackSource) GetEpisodes(animeID string) ([]extensions.Episode, error) {
	return s.episodes, nil
}

func (s *stubAnimePlaybackSource) GetStreamSources(episodeID string) ([]extensions.StreamSource, error) {
	return s.streams, nil
}

func newIntegratedPlaybackTestDB(t *testing.T) *db.Database {
	t.Helper()

	t.Setenv("APPDATA", t.TempDir())

	database, err := db.New()
	if err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		database.Close()
	})
	return database
}

func waitForTestCondition(t *testing.T, timeout time.Duration, fn func() bool) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("condition not met within %s", timeout)
}

func localPathFromFileURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "file" {
		return ""
	}
	path := parsed.Path
	if len(path) >= 3 && path[0] == '/' && path[2] == ':' {
		path = path[1:]
	}
	return filepath.FromSlash(path)
}

func writeTestThumbnailFile(t *testing.T, name string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte("test-thumbnail"), 0o644); err != nil {
		t.Fatalf("write test thumbnail: %v", err)
	}
	return fileURLForPath(path)
}

func writeBlackThumbnailFile(t *testing.T, name string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), name)
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create black thumbnail: %v", err)
	}
	defer file.Close()

	img := image.NewRGBA(image.Rect(0, 0, 12, 12))
	for y := 0; y < 12; y += 1 {
		for x := 0; x < 12; x += 1 {
			img.Set(x, y, color.RGBA{R: 0, G: 0, B: 0, A: 255})
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatalf("encode black thumbnail: %v", err)
	}
	return fileURLForPath(path)
}

func TestOpenOnlineEpisodeIntegratedPayloadPreservesCookieBackedStreams(t *testing.T) {
	database := newIntegratedPlaybackTestDB(t)

	app := &App{
		db:       database,
		registry: extensions.NewRegistry(),
	}
	app.registry.RegisterAnime(&stubAnimePlaybackSource{
		stubAnimeSource: stubAnimeSource{id: "stub-playback-en"},
		streams: []extensions.StreamSource{
			{
				URL:      "https://media.example/episode-1.m3u8",
				Quality:  "1080p",
				Language: extensions.LangEnglish,
				Audio:    "sub",
				Referer:  "https://provider.example/watch",
				Cookie:   "session=abc123",
			},
		},
	})

	payload, err := app.OpenOnlineEpisode(
		"stub-playback-en",
		"episode-1",
		"anime-1",
		"Example Show",
		"",
		0,
		0,
		1,
		"Episode 1",
		"",
		"integrated",
	)
	if err != nil {
		t.Fatalf("open online episode: %v", err)
	}

	proxyURL, _ := payload["proxy_url"].(string)
	if strings.TrimSpace(proxyURL) == "" {
		t.Fatalf("expected proxy_url in payload, got %#v", payload)
	}

	parsed, err := url.Parse(proxyURL)
	if err != nil {
		t.Fatalf("parse proxy_url: %v", err)
	}
	if got := parsed.Query().Get("cookie"); got != "session=abc123" {
		t.Fatalf("expected cookie query param to be preserved, got %q in %q", got, proxyURL)
	}
	if got, _ := payload["has_cookie"].(bool); !got {
		t.Fatalf("expected has_cookie=true, got %#v", payload["has_cookie"])
	}
}

func TestPrepareOnlineEpisodeThumbnailReturnsResolvedStreamContext(t *testing.T) {
	database := newIntegratedPlaybackTestDB(t)

	app := &App{
		db:       database,
		registry: extensions.NewRegistry(),
	}
	app.registry.RegisterAnime(&stubAnimePlaybackSource{
		stubAnimeSource: stubAnimeSource{id: "stub-playback-en"},
		streams: []extensions.StreamSource{
			{
				URL:      "https://media.example/episode-1.m3u8",
				Quality:  "1080p",
				Language: extensions.LangEnglish,
				Audio:    "sub",
				Referer:  "https://provider.example/watch",
				Cookie:   "session=abc123",
			},
		},
	})

	result, err := app.PrepareOnlineEpisodeThumbnail(map[string]interface{}{
		"source_id":     "stub-playback-en",
		"anime_id":      "anime-1",
		"episode_id":    "episode-1",
		"episode_num":   1.0,
		"episode_title": "Episode 1",
		"source_label":  "Stub Anime",
	})
	if err != nil {
		t.Fatalf("prepare thumbnail context: %v", err)
	}

	if got, _ := result["raw_stream_url"].(string); got != "https://media.example/episode-1.m3u8" {
		t.Fatalf("expected raw stream url to be preserved, got %#v", result)
	}
	if got, _ := result["proxy_url"].(string); strings.TrimSpace(got) == "" {
		t.Fatalf("expected proxy_url in prepared thumbnail payload, got %#v", result)
	}
	if got, _ := result["stream_kind"].(string); got != "hls" {
		t.Fatalf("expected stream_kind=hls in prepared thumbnail payload, got %#v", result)
	}
	if got, _ := result["source_label"].(string); got != "Stub Anime" {
		t.Fatalf("expected source label to survive preparation, got %#v", result)
	}
}

func TestGetOnlineEpisodesDoesNotReplaceEpisodeListThumbnailsWithCachedLocalFiles(t *testing.T) {
	database := newIntegratedPlaybackTestDB(t)

	app := &App{
		db:       database,
		registry: extensions.NewRegistry(),
	}
	app.registry.RegisterAnime(&stubAnimePlaybackSource{
		stubAnimeSource: stubAnimeSource{id: "stub-episodes-en"},
		episodes: []extensions.Episode{
			{ID: "episode-1", Number: 1, Title: "Episode 1"},
			{ID: "episode-2", Number: 2, Title: "Episode 2", Thumbnail: "https://provider.example/episode-2.jpg"},
		},
	})
	cachedEpisode1 := writeTestThumbnailFile(t, "episode-1.webp")
	cachedEpisode2 := writeTestThumbnailFile(t, "episode-2.webp")

	if err := database.RecordOnlineWatch(db.WatchHistoryEntry{
		SourceID:     "stub-episodes-en",
		SourceName:   "Stub Anime",
		AnimeID:      "anime-1",
		AnimeTitle:   "Example Show",
		EpisodeID:    "episode-1",
		EpisodeNum:   1,
		EpisodeTitle: "Episode 1",
		EpisodeThumb: cachedEpisode1,
	}); err != nil {
		t.Fatalf("record cached thumbnail for episode 1: %v", err)
	}
	if err := database.RecordOnlineWatch(db.WatchHistoryEntry{
		SourceID:     "stub-episodes-en",
		SourceName:   "Stub Anime",
		AnimeID:      "anime-1",
		AnimeTitle:   "Example Show",
		EpisodeID:    "episode-2",
		EpisodeNum:   2,
		EpisodeTitle: "Episode 2",
		EpisodeThumb: cachedEpisode2,
	}); err != nil {
		t.Fatalf("record cached thumbnail for episode 2: %v", err)
	}

	episodes, err := app.GetOnlineEpisodes("stub-episodes-en", "anime-1")
	if err != nil {
		t.Fatalf("get online episodes: %v", err)
	}
	if len(episodes) != 2 {
		t.Fatalf("expected 2 episodes, got %d", len(episodes))
	}

	byID := map[string]map[string]interface{}{}
	for _, episode := range episodes {
		id, _ := episode["id"].(string)
		byID[id] = episode
	}

	if got, _ := byID["episode-1"]["thumbnail"].(string); got != "" {
		t.Fatalf("expected episode-1 to keep the source thumbnail empty when only a cached local file exists, got %q", got)
	}
	if got, _ := byID["episode-2"]["thumbnail"].(string); got != "https://provider.example/episode-2.jpg" {
		t.Fatalf("expected episode-2 to keep provider art ahead of cached local files, got %q", got)
	}
}

func TestWarmOnlineEpisodeThumbnailReturnsCachedOrScheduledResult(t *testing.T) {
	database := newIntegratedPlaybackTestDB(t)

	app := &App{
		db: database,
	}
	app.configureStoragePaths()
	cachedEpisode7 := writeTestThumbnailFile(t, "series-123-ep-7.webp")

	if err := database.RecordOnlineWatch(db.WatchHistoryEntry{
		SourceID:     "animepahe-en",
		SourceName:   "AnimePahe",
		AnimeID:      "series-123",
		AnimeTitle:   "Example Show",
		EpisodeID:    "ep-7",
		EpisodeNum:   7,
		EpisodeTitle: "Episode 7",
		EpisodeThumb: cachedEpisode7,
	}); err != nil {
		t.Fatalf("record cached online watch: %v", err)
	}

	cached, err := app.WarmOnlineEpisodeThumbnail(map[string]interface{}{
		"source_id":  "animepahe-en",
		"anime_id":   "series-123",
		"episode_id": "ep-7",
	})
	if err != nil {
		t.Fatalf("warm cached thumbnail: %v", err)
	}
	if got, _ := cached["status"].(string); got != "cached" {
		t.Fatalf("expected cached status, got %#v", cached)
	}
	if got, _ := cached["thumbnail_url"].(string); got != cachedEpisode7 {
		t.Fatalf("expected cached thumbnail url, got %#v", cached)
	}

	imageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("fake-jpeg-thumbnail"))
	}))
	defer imageServer.Close()

	warmPayload := map[string]interface{}{
		"source_id":     "animepahe-en",
		"source_label":  "AnimePahe",
		"anime_id":      "series-123",
		"anime_title":   "Example Show",
		"episode_id":    "ep-8",
		"episode_num":   8.0,
		"episode_title": "Episode 8",
		"stream_url":    imageServer.URL + "/thumb.jpg",
		"stream_kind":   "image",
	}

	scheduled, err := app.WarmOnlineEpisodeThumbnail(warmPayload)
	if err != nil {
		t.Fatalf("warm scheduled thumbnail: %v", err)
	}
	if got, _ := scheduled["status"].(string); got != "scheduled" {
		t.Fatalf("expected scheduled status, got %#v", scheduled)
	}
	if err := app.tryWarmEpisodeThumbnail(cloneInterfaceMap(warmPayload)); err != nil {
		t.Fatalf("persist warmed thumbnail: %v", err)
	}

	progress, err := database.GetOnlineWatchProgress("animepahe-en", "ep-8")
	if err != nil {
		t.Fatalf("read warmed watch progress: %v", err)
	}
	storedThumb := progress.EpisodeThumb
	if !strings.HasPrefix(storedThumb, "file://") {
		t.Fatalf("expected persisted local thumbnail, got %q", storedThumb)
	}
	path := localPathFromFileURL(storedThumb)
	if path == "" {
		t.Fatalf("expected persisted file path from %q", storedThumb)
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		t.Fatalf("expected persisted thumbnail file, got path=%q err=%v", path, err)
	}

	reloaded := &App{db: database}
	cachedAgain, err := reloaded.WarmOnlineEpisodeThumbnail(map[string]interface{}{
		"source_id":  "animepahe-en",
		"anime_id":   "series-123",
		"episode_id": "ep-8",
	})
	if err != nil {
		t.Fatalf("warm cached thumbnail after persistence: %v", err)
	}
	if got, _ := cachedAgain["status"].(string); got != "cached" {
		t.Fatalf("expected cached status after persistence, got %#v", cachedAgain)
	}
	if got, _ := cachedAgain["thumbnail_url"].(string); got != storedThumb {
		t.Fatalf("expected persisted thumbnail %q, got %#v", storedThumb, cachedAgain)
	}
}

func TestWarmOnlineEpisodeThumbnailIgnoresBlackCachedThumbnail(t *testing.T) {
	database := newIntegratedPlaybackTestDB(t)

	app := &App{
		db: database,
	}
	app.configureStoragePaths()
	blackThumb := writeBlackThumbnailFile(t, "series-123-ep-black.png")

	if err := database.RecordOnlineWatch(db.WatchHistoryEntry{
		SourceID:     "animepahe-en",
		SourceName:   "AnimePahe",
		AnimeID:      "series-123",
		AnimeTitle:   "Example Show",
		EpisodeID:    "ep-10",
		EpisodeNum:   10,
		EpisodeTitle: "Episode 10",
		EpisodeThumb: blackThumb,
	}); err != nil {
		t.Fatalf("record black cached thumbnail: %v", err)
	}

	result, err := app.WarmOnlineEpisodeThumbnail(map[string]interface{}{
		"source_id":     "animepahe-en",
		"source_label":  "AnimePahe",
		"anime_id":      "series-123",
		"anime_title":   "Example Show",
		"episode_id":    "ep-10",
		"episode_num":   10.0,
		"episode_title": "Episode 10",
		"stream_url":    "https://cdn.example.com/master.m3u8",
		"stream_kind":   "hls",
	})
	if err != nil {
		t.Fatalf("warm thumbnail with black cache: %v", err)
	}
	if got, _ := result["status"].(string); got != "scheduled" {
		t.Fatalf("expected black cached thumbnail to be rejected and re-warmed, got %#v", result)
	}
}

func TestPersistOnlineEpisodeThumbnailCachesCapturedStill(t *testing.T) {
	database := newIntegratedPlaybackTestDB(t)

	app := &App{
		db: database,
	}
	app.configureStoragePaths()

	pngDataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("fake-png-thumbnail"))

	result, err := app.PersistOnlineEpisodeThumbnail(map[string]interface{}{
		"source_id":          "animepahe-en",
		"source_label":       "AnimePahe",
		"anime_id":           "series-123",
		"anime_title":        "Example Show",
		"episode_id":         "ep-9",
		"episode_num":        9.0,
		"episode_title":      "Episode 9",
		"thumbnail_data_url": pngDataURL,
	})
	if err != nil {
		t.Fatalf("persist captured still: %v", err)
	}

	storedThumb, _ := result["thumbnail_url"].(string)
	if !strings.HasPrefix(storedThumb, "file://") {
		t.Fatalf("expected persisted local thumbnail, got %#v", result)
	}

	progress, err := database.GetOnlineWatchProgress("animepahe-en", "ep-9")
	if err != nil {
		t.Fatalf("read cached thumbnail progress: %v", err)
	}
	if progress.EpisodeThumb != storedThumb {
		t.Fatalf("expected cached thumbnail %q, got %q", storedThumb, progress.EpisodeThumb)
	}
}

func TestPersistOnlineEpisodeThumbnailRejectsBlackCapturedStill(t *testing.T) {
	database := newIntegratedPlaybackTestDB(t)

	app := &App{
		db: database,
	}
	app.configureStoragePaths()

	blackImage := image.NewRGBA(image.Rect(0, 0, 24, 24))
	for y := 0; y < 24; y += 1 {
		for x := 0; x < 24; x += 1 {
			blackImage.Set(x, y, color.RGBA{R: 0, G: 0, B: 0, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, blackImage); err != nil {
		t.Fatalf("encode black captured still: %v", err)
	}
	pngDataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())

	result, err := app.PersistOnlineEpisodeThumbnail(map[string]interface{}{
		"source_id":          "animepahe-en",
		"source_label":       "AnimePahe",
		"anime_id":           "series-123",
		"anime_title":        "Example Show",
		"episode_id":         "ep-black",
		"episode_num":        11.0,
		"episode_title":      "Episode 11",
		"thumbnail_data_url": pngDataURL,
	})
	if err != nil {
		t.Fatalf("persist black captured still: %v", err)
	}
	if got, _ := result["status"].(string); got != "rejected" {
		t.Fatalf("expected rejected status for black captured still, got %#v", result)
	}
}

func TestOpenOnlineEpisodeIntegratedPayloadIncludesThumbnailAndStreamIdentity(t *testing.T) {
	database := newIntegratedPlaybackTestDB(t)

	app := &App{
		db:       database,
		registry: extensions.NewRegistry(),
	}
	app.registry.RegisterAnime(&stubAnimePlaybackSource{
		stubAnimeSource: stubAnimeSource{id: "stub-payload-en"},
		streams: []extensions.StreamSource{
			{
				URL:      "https://media.example/episode-7.m3u8",
				Quality:  "1080p",
				Language: extensions.LangEnglish,
				Audio:    "sub",
				Referer:  "https://provider.example/watch",
			},
		},
	})

	payload, err := app.OpenOnlineEpisode(
		"stub-payload-en",
		"ep-7",
		"series-123",
		"Example Show",
		"https://image.example/cover.jpg",
		1001,
		2002,
		7,
		"Episode 7",
		"",
		"integrated",
	)
	if err != nil {
		t.Fatalf("open online episode: %v", err)
	}

	required := []string{"stream_url", "stream_kind", "source_label", "fallback_type", "proxy_url", "raw_stream_url", "episode_thumbnail"}
	for _, key := range required {
		if _, ok := payload[key]; !ok {
			t.Fatalf("expected key %q in payload %#v", key, payload)
		}
	}
	if got, _ := payload["source_label"].(string); got != "Stub Anime" {
		t.Fatalf("expected source_label to be Stub Anime, got %q", got)
	}
	if got, _ := payload["raw_stream_url"].(string); got != "https://media.example/episode-7.m3u8" {
		t.Fatalf("expected raw_stream_url to be preserved, got %q", got)
	}
}

func TestOpenOnlineEpisodeIntegratedFallsBackFromBrokenAnimeAV1HLSCandidate(t *testing.T) {
	database := newIntegratedPlaybackTestDB(t)

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

	workingMP4 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Accept-Ranges", "bytes")
		if strings.TrimSpace(r.Header.Get("Range")) != "" {
			w.Header().Set("Content-Range", "bytes 0-0/1")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = io.WriteString(w, "x")
			return
		}
		_, _ = io.WriteString(w, "video")
	}))
	defer workingMP4.Close()

	app := &App{
		db:       database,
		registry: extensions.NewRegistry(),
	}
	app.registry.RegisterAnime(&stubAnimePlaybackSource{
		stubAnimeSource: stubAnimeSource{id: "animeav1-es"},
		streams: []extensions.StreamSource{
			{
				URL:      brokenHLS.URL + "/master.m3u8",
				Quality:  "unknown",
				Language: extensions.LangSpanish,
				Audio:    "sub",
				Referer:  "https://player.zilla-networks.com/play/example",
			},
			{
				URL:      workingMP4.URL + "/video.mp4",
				Quality:  "unknown",
				Language: extensions.LangSpanish,
				Audio:    "sub",
				Referer:  "https://www.mp4upload.com/embed-example.html",
			},
		},
	})

	payload, err := app.OpenOnlineEpisode(
		"animeav1-es",
		"episode-1",
		"anime-1",
		"Example Show",
		"",
		0,
		0,
		1,
		"Episode 1",
		"",
		"integrated",
	)
	if err != nil {
		t.Fatalf("open online episode: %v", err)
	}

	if got, _ := payload["raw_stream_url"].(string); got != workingMP4.URL+"/video.mp4" {
		t.Fatalf("expected integrated playback to skip broken AnimeAV1 HLS candidate, got %#v", payload)
	}
	if got, _ := payload["stream_kind"].(string); got != "file" {
		t.Fatalf("expected fallback AnimeAV1 stream to be treated as file playback, got %#v", payload)
	}
}

func TestOpenOnlineEpisodeIntegratedFallsBackFromBrokenAnimePaheHLSCandidate(t *testing.T) {
	database := newIntegratedPlaybackTestDB(t)

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

	app := &App{
		db:       database,
		registry: extensions.NewRegistry(),
	}
	app.registry.RegisterAnime(&stubAnimePlaybackSource{
		stubAnimeSource: stubAnimeSource{id: "animepahe-en"},
		streams: []extensions.StreamSource{
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
		},
	})

	payload, err := app.OpenOnlineEpisode(
		"animepahe-en",
		"episode-7",
		"anime-1",
		"Example Show",
		"",
		0,
		0,
		7,
		"Episode 7",
		"",
		"integrated",
	)
	if err != nil {
		t.Fatalf("open online episode: %v", err)
	}

	if got, _ := payload["raw_stream_url"].(string); got != workingHLS.URL+"/backup.m3u8" {
		t.Fatalf("expected integrated playback to skip broken AnimePahe HLS candidate, got %#v", payload)
	}
	if got, _ := payload["referer"].(string); got != "https://kwik.si/e/working" {
		t.Fatalf("expected fallback AnimePahe referer to follow the chosen candidate, got %#v", payload)
	}
}
