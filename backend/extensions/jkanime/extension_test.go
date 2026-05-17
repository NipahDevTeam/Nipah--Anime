package jkanime

import (
	"encoding/base64"
	"testing"
)

func TestExtractJKAnimeEmbedCandidatesPrefersDecodedRemoteServers(t *testing.T) {
	mp4upload := "https://www.mp4upload.com/embed-ap9y5sdg4h0b.html"
	voe := "https://voe.sx/e/pmk08pncotot"
	jkplayer := "https://jkanime.net/jkplayer/um?e=token&t=thumb&op=test"

	body := `
	<script>
		video[0] = '<iframe class="player_conte" src="` + jkplayer + `" width="565" height="318"></iframe>';
		var servers = [
			{"remote":"` + base64.StdEncoding.EncodeToString([]byte(mp4upload)) + `","slug":"mp4","server":"Mp4upload","lang":1,"size":"482 MB","append":0},
			{"remote":"` + base64.StdEncoding.EncodeToString([]byte(voe)) + `","slug":"voe","server":"VOE","lang":1,"size":"482 MB","append":0}
		];
	</script>`

	candidates := extractJKAnimeEmbedCandidates(body)
	if len(candidates) != 3 {
		t.Fatalf("expected 3 embed candidates, got %d (%#v)", len(candidates), candidates)
	}
	if candidates[0].url != mp4upload || candidates[0].server != "Mp4upload" {
		t.Fatalf("expected decoded MP4Upload server first, got %#v", candidates[0])
	}
	if candidates[1].url != voe || candidates[1].server != "VOE" {
		t.Fatalf("expected decoded VOE server second, got %#v", candidates[1])
	}
	if candidates[2].url != jkplayer {
		t.Fatalf("expected jkplayer iframe fallback last, got %#v", candidates[2])
	}
}
