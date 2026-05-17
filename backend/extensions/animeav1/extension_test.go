package animeav1

import (
	"fmt"
	"strings"
	"testing"

	"miruro/backend/extensions"
)

func TestParseSearchDataFallsBackToLinkedImageAltTitles(t *testing.T) {
	body := `
	<section>
		<a class="group" href="/media/pick-me-up">
			<img src="https://cdn.animeav1.com/covers/123.jpg" alt="Pick Me Up!" />
		</a>
		<a class="group" href="/media/omniscient-readers-viewpoint">
			<img src="https://cdn.animeav1.com/covers/456.jpg" title="Omniscient Reader's Viewpoint" />
		</a>
	</section>`

	results := parseSearchData(body)
	if len(results) != 2 {
		t.Fatalf("expected 2 fallback results, got %d (%#v)", len(results), results)
	}
	if results[0].ID != "/media/pick-me-up" || results[0].Title != "Pick Me Up!" {
		t.Fatalf("unexpected first fallback result: %#v", results[0])
	}
	if results[1].ID != "/media/omniscient-readers-viewpoint" || results[1].Title != "Omniscient Reader's Viewpoint" {
		t.Fatalf("unexpected second fallback result: %#v", results[1])
	}
}

func TestAnimeAV1AudioVariantsFromBodyDetectsSubAndDub(t *testing.T) {
	body := `
	data: {embeds:{
		DUB:[{server:"MP4Upload",url:"https://dub.example/720"}],
		SUB:[{server:"MP4Upload",url:"https://sub.example/1080"}]
	}}`

	variants := animeAV1AudioVariantsFromBody(body)
	if !variants["sub"] {
		t.Fatalf("expected sub variant to be available, got %#v", variants)
	}
	if !variants["dub"] {
		t.Fatalf("expected dub variant to be available, got %#v", variants)
	}
}

func TestSelectAnimeAV1SourcesPreservesBothAudioVariants(t *testing.T) {
	resolved := []animeAV1ResolvedSource{
		{
			source: extensions.StreamSource{
				URL:     "https://sub.example/720.m3u8",
				Quality: "720p",
				Audio:   "sub",
			},
			order: 0,
		},
		{
			source: extensions.StreamSource{
				URL:     "https://sub.example/1080.m3u8",
				Quality: "1080p",
				Audio:   "sub",
			},
			order: 1,
		},
		{
			source: extensions.StreamSource{
				URL:     "https://dub.example/480.m3u8",
				Quality: "480p",
				Audio:   "dub",
			},
			order: 2,
		},
		{
			source: extensions.StreamSource{
				URL:     "https://dub.example/720.m3u8",
				Quality: "720p",
				Audio:   "dub",
			},
			order: 3,
		},
	}

	selected := selectAnimeAV1Sources(resolved, map[string]bool{
		"sub": true,
		"dub": true,
	})
	if len(selected) != 2 {
		t.Fatalf("expected 2 selected sources, got %d (%#v)", len(selected), selected)
	}
	if selected[0].Audio != "sub" || selected[0].Quality != "1080p" {
		t.Fatalf("expected best sub source first, got %#v", selected[0])
	}
	if selected[1].Audio != "dub" || selected[1].Quality != "720p" {
		t.Fatalf("expected best dub source second, got %#v", selected[1])
	}
}

func TestSelectAnimeAV1SourcesFallsBackToBestSingleVariantSources(t *testing.T) {
	resolved := []animeAV1ResolvedSource{
		{
			source: extensions.StreamSource{
				URL:     "https://sub.example/480.m3u8",
				Quality: "480p",
				Audio:   "sub",
			},
			order: 1,
		},
		{
			source: extensions.StreamSource{
				URL:     "https://sub.example/1080.m3u8",
				Quality: "1080p",
				Audio:   "sub",
			},
			order: 0,
		},
		{
			source: extensions.StreamSource{
				URL:     "https://sub.example/720.m3u8",
				Quality: "720p",
				Audio:   "sub",
			},
			order: 2,
		},
	}

	selected := selectAnimeAV1Sources(resolved, map[string]bool{
		"sub": true,
		"dub": false,
	})
	if len(selected) != 2 {
		t.Fatalf("expected 2 selected fallback sources, got %d (%#v)", len(selected), selected)
	}
	if selected[0].Quality != "1080p" || selected[1].Quality != "720p" {
		t.Fatalf("expected best single-variant sources, got %#v", selected)
	}
}

func TestParseEpisodesPrefersEmbeddedHydrationEpisodeList(t *testing.T) {
	var hrefs strings.Builder
	for episode := 1; episode <= 50; episode++ {
		hrefs.WriteString(fmt.Sprintf(`<a href="/media/black-clover/%d">Ver %d</a>`, episode, episode))
	}

	var embedded strings.Builder
	for episode := 1; episode <= 55; episode++ {
		if episode > 1 {
			embedded.WriteByte(',')
		}
		embedded.WriteString(fmt.Sprintf(`{id:%d,number:%d}`, 14000+episode, episode))
	}

	body := hrefs.String() + `<script>kit.start(app, element, {data:[null,{type:"data",data:{media:{episodes:[` + embedded.String() + `],relations:[]}}]});</script>`

	episodes := parseEpisodes(body, "black-clover")
	if len(episodes) != 55 {
		t.Fatalf("expected embedded hydration episodes to include all 55 entries, got %d", len(episodes))
	}
	if episodes[len(episodes)-1].ID != "/media/black-clover/55" {
		t.Fatalf("expected final embedded episode to be 55, got %#v", episodes[len(episodes)-1])
	}
}

func TestAnimeAV1ShouldDeferEmbedTreatsZillaPlayAsFast(t *testing.T) {
	if animeAV1ShouldDeferEmbed("https://player.zilla-networks.com/play/895959da0493f8f975e01708b9237c34") {
		t.Fatal("expected zilla play embeds to stay on the fast path")
	}
	if !animeAV1ShouldDeferEmbed("https://mega.nz/embed/H7gwBQTD#token") {
		t.Fatal("expected mega embeds to remain deferred")
	}
	if animeAV1ShouldDeferEmbed("https://www.mp4upload.com/embed-ap9y5sdg4h0b.html") {
		t.Fatal("expected mp4upload embeds to remain on the fast path")
	}
}

func TestPartitionAnimeAV1CandidatesDefersSameTrackFallbacksWhenHLSExists(t *testing.T) {
	fast, slow := partitionAnimeAV1Candidates([]embedCandidate{
		{
			track:  "SUB",
			server: "HLS",
			url:    "https://player.zilla-networks.com/play/sub-track",
		},
		{
			track:  "SUB",
			server: "MP4Upload",
			url:    "https://www.mp4upload.com/embed-sub.html",
		},
		{
			track:  "SUB",
			server: "PDrain",
			url:    "https://pixeldrain.com/u/sub?embed",
		},
		{
			track:  "DUB",
			server: "MP4Upload",
			url:    "https://www.mp4upload.com/embed-dub.html",
		},
	})

	if len(fast) != 2 {
		t.Fatalf("expected 2 fast candidates, got %d (%#v)", len(fast), fast)
	}
	if fast[0].server != "HLS" || fast[1].server != "MP4Upload" || fast[1].track != "DUB" {
		t.Fatalf("unexpected fast candidates: %#v", fast)
	}
	if len(slow) != 2 {
		t.Fatalf("expected 2 slow candidates, got %d (%#v)", len(slow), slow)
	}
	if slow[0].server != "MP4Upload" || slow[1].server != "PDrain" {
		t.Fatalf("unexpected slow candidates: %#v", slow)
	}
}
