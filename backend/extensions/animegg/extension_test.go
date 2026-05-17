package animegg

import (
	"errors"
	"reflect"
	"testing"

	"miruro/backend/extensions"
)

func TestAnimeGGExtractEmbedVariantsParsesLiveLikeMarkup(t *testing.T) {
	body := `
<ul id="videos" class="nav nav-tabs">
  <li><a href="#subbed-Animegg" data-toggle="tab" data-id='144016' data-mirror="Animegg" data-version="subbed">SUBBED</a></li>
  <li><a href="#dubbed-Animegg" data-toggle="tab" data-id='145231' data-mirror="Animegg" data-version="dubbed">DUBBED</a></li>
</ul>
<div class="tab-content embed-responsive embed-responsive-16by9">
  <div id="subbed-Animegg" class="tab-pane">
    <iframe src="/embed/144016" class="video"></iframe>
  </div>
  <div id="dubbed-Animegg" class="tab-pane">
    <iframe src="/embed/145231" class="video"></iframe>
  </div>
</div>`

	got := animeGGExtractEmbedVariants(body)
	want := []animeGGEmbedVariant{
		{Audio: "sub", URL: "https://www.animegg.org/embed/144016"},
		{Audio: "dub", URL: "https://www.animegg.org/embed/145231"},
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected variants:\n got: %#v\nwant: %#v", got, want)
	}
}

func TestAnimeGGSelectEmbedURLsHonorsExplicitAudio(t *testing.T) {
	variants := []animeGGEmbedVariant{
		{Audio: "sub", URL: "https://www.animegg.org/embed/144016"},
		{Audio: "dub", URL: "https://www.animegg.org/embed/145231"},
	}

	gotDub := animeGGSelectEmbedURLs(nil, variants, "dub")
	wantDub := []string{"https://www.animegg.org/embed/145231"}
	if !reflect.DeepEqual(gotDub, wantDub) {
		t.Fatalf("unexpected dub embeds:\n got: %#v\nwant: %#v", gotDub, wantDub)
	}

	gotMissing := animeGGSelectEmbedURLs(nil, variants[:1], "dub")
	if gotMissing != nil {
		t.Fatalf("expected missing dub request to return nil, got %#v", gotMissing)
	}
}

func TestAnimeGGAudioVariantCacheKeyIsEpisodeScoped(t *testing.T) {
	first := animeGGAudioVariantCacheKey("/one-piece-episode-1161/")
	second := animeGGAudioVariantCacheKey("/one-piece-episode-1155/")

	if first == "" || second == "" {
		t.Fatalf("cache keys should not be empty: first=%q second=%q", first, second)
	}
	if first == second {
		t.Fatalf("episode cache keys must differ, got %q", first)
	}
}

func TestAnimeGGFetchPageRetriesTransientFailures(t *testing.T) {
	original := animeGGFetchPageWithHeaders
	defer func() {
		animeGGFetchPageWithHeaders = original
	}()

	attempts := 0
	animeGGFetchPageWithHeaders = func(url, referer string, headers map[string]string) (string, error) {
		attempts++
		if attempts < 3 {
			return "", errors.New("i/o timeout")
		}
		return "ok", nil
	}

	body, err := fetchPage("https://www.animegg.org/example", baseURL)
	if err != nil {
		t.Fatalf("fetchPage returned error: %v", err)
	}
	if body != "ok" {
		t.Fatalf("unexpected body %q", body)
	}
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
}

func TestAnimeGGGetStreamSourcesUpgradesSessionlessPlayURLs(t *testing.T) {
	originalFetch := animeGGFetchPageWithHeaders
	originalEmbedSources := animeGGFetchEmbedSourcesFn
	originalBrowserSession := animeGGBrowserSessionStreamFn
	defer func() {
		animeGGFetchPageWithHeaders = originalFetch
		animeGGFetchEmbedSourcesFn = originalEmbedSources
		animeGGBrowserSessionStreamFn = originalBrowserSession
	}()

	animeGGFetchPageWithHeaders = func(url, referer string, headers map[string]string) (string, error) {
		return `
<ul id="videos" class="nav nav-tabs">
  <li><a href="#subbed-Animegg" data-toggle="tab" data-version="subbed">SUBBED</a></li>
</ul>
<div class="tab-content embed-responsive embed-responsive-16by9">
  <div id="subbed-Animegg" class="tab-pane">
    <iframe src="/embed/145710" class="video"></iframe>
  </div>
</div>`, nil
	}

	animeGGFetchEmbedSourcesFn = func(embedURL, referer, audio string) ([]extensions.StreamSource, error) {
		return []extensions.StreamSource{{
			URL:      "https://www.animegg.org/play/542832/video.mp4?for=101778620479218",
			Quality:  "1080p",
			Language: extensions.LangEnglish,
			Audio:    "sub",
			Referer:  embedURL,
		}}, nil
	}

	browserCalls := 0
	animeGGBrowserSessionStreamFn = func(episodeURL string, targetAudio string, preferredEmbedURL string, quickMode bool) []extensions.StreamSource {
		browserCalls++
		return []extensions.StreamSource{{
			URL:      "https://s406.vidcache.net:8166/play/a202605121U831cFUGPl/video.mp4?cid=36019374",
			Quality:  "1080p",
			Language: extensions.LangEnglish,
			Audio:    "sub",
			Referer:  "https://www.animegg.org/embed/145710",
			Cookie:   "connect.sid=session",
		}}
	}

	streams, err := New().GetStreamSources("/one-piece-episode-1161/")
	if err != nil {
		t.Fatalf("GetStreamSources returned error: %v", err)
	}
	if browserCalls != 1 {
		t.Fatalf("expected browser session upgrade to run once, got %d", browserCalls)
	}
	if len(streams) == 0 {
		t.Fatalf("expected streams")
	}
	if streams[0].Cookie == "" {
		t.Fatalf("expected session-backed stream to be preferred first, got %#v", streams[0])
	}
	if got := streams[0].URL; got != "https://s406.vidcache.net:8166/play/a202605121U831cFUGPl/video.mp4?cid=36019374" {
		t.Fatalf("unexpected first stream url %q", got)
	}
}
