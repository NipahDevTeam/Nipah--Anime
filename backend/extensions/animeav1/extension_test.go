package animeav1

import "testing"

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
