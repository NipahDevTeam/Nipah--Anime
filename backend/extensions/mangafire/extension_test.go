package mangafire

import (
	"testing"

	"miruro/backend/extensions"
)

func TestChapterMatchesLanguage(t *testing.T) {
	slug := "blue-lockk.kw9j9"

	if !chapterMatchesLanguage("https://mangafire.to/read/blue-lockk.kw9j9/en/chapter-305", slug, []string{"en"}) {
		t.Fatal("expected English chapter URL to match English profile")
	}

	if chapterMatchesLanguage("https://mangafire.to/read/blue-lockk.kw9j9/es/chapter-305", slug, []string{"en"}) {
		t.Fatal("did not expect Spanish chapter URL to match English profile")
	}

	if !chapterMatchesLanguage("https://mangafire.to/read/blue-lockk.kw9j9/es/chapter-305", slug, []string{"es", "es-la"}) {
		t.Fatal("expected Spanish chapter URL to match Spanish profile")
	}

	if !chapterMatchesLanguage("https://mangafire.to/read/blue-lockk.kw9j9/es-la/chapter-305", slug, []string{"es", "es-la"}) {
		t.Fatal("expected Spanish (LATAM) chapter URL to match Spanish profile")
	}
}

func TestProfilesExposeExpectedMetadata(t *testing.T) {
	english := NewEnglish()
	spanish := NewSpanish()

	if english.ID() != sourceIDEnglish || english.Name() != "MangaFire (EN)" {
		t.Fatalf("unexpected English profile metadata: id=%q name=%q", english.ID(), english.Name())
	}
	if spanish.ID() != sourceIDSpanish || spanish.Name() != "MangaFire (ES)" {
		t.Fatalf("unexpected Spanish profile metadata: id=%q name=%q", spanish.ID(), spanish.Name())
	}

	if got := english.Languages(); len(got) != 1 || got[0] != extensions.LangEnglish {
		t.Fatalf("unexpected English languages: %#v", got)
	}
	if got := spanish.Languages(); len(got) != 1 || got[0] != extensions.LangSpanish {
		t.Fatalf("unexpected Spanish languages: %#v", got)
	}
}

func TestParseChapterLanguageCounts(t *testing.T) {
	body := `
	<div class="dropdown-menu">
	  <a class="dropdown-item active" href="#" data-code="EN" data-title="English"><i class="flag EN"></i> English (355 Chapters) </a>
	  <a class="dropdown-item " href="#" data-code="ES" data-title="Spanish"><i class="flag ES"></i> Spanish (64 Chapters) </a>
	  <a class="dropdown-item " href="#" data-code="ES-LA" data-title="Spanish (LATAM)"><i class="flag ES-LA"></i> Spanish (LATAM) (338 Chapters) </a>
	</div>`

	counts := parseChapterLanguageCounts(body)
	if counts["en"] != 355 || counts["es"] != 64 || counts["es-la"] != 338 {
		t.Fatalf("unexpected counts: %#v", counts)
	}
}

func TestSynthesizeLanguageChaptersPrefersLargestSpanishVariant(t *testing.T) {
	matches := [][]string{
		{"", "345", "/read/blue-lockk.kw9j9/en/chapter-345", "Vol 0 - Chap 345", "Chapter 345:", "8 hours ago"},
		{"", "344", "/read/blue-lockk.kw9j9/en/chapter-344", "Vol 0 - Chap 344", "Chapter 344:", "8 hours ago"},
		{"", "343", "/read/blue-lockk.kw9j9/en/chapter-343", "Vol 0 - Chap 343", "Chapter 343:", "Apr 22, 2026"},
	}

	chapters := synthesizeLanguageChapters(matches, "blue-lockk.kw9j9", spanishProfile, map[string]int{
		"es":    2,
		"es-la": 3,
	})
	if len(chapters) != 3 {
		t.Fatalf("expected 3 synthesized chapters, got %d", len(chapters))
	}
	if chapters[0].ID != "https://mangafire.to/read/blue-lockk.kw9j9/es-la/chapter-343" {
		t.Fatalf("unexpected first synthesized chapter: %#v", chapters[0])
	}
	if chapters[2].ID != "https://mangafire.to/read/blue-lockk.kw9j9/es-la/chapter-345" {
		t.Fatalf("unexpected last synthesized chapter: %#v", chapters[2])
	}
}
