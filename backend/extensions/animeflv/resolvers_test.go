package animeflv

import "testing"

func TestIsEmbedPageURLRecognizesZillaPlayPages(t *testing.T) {
	if !IsEmbedPageURL("https://player.zilla-networks.com/play/851cb91f6f2f43b2efaee829e5be6e28") {
		t.Fatal("expected Zilla /play/ URLs to be treated as embed pages")
	}
}

func TestResolveZillaManifestURLConvertsPlayPageToManifest(t *testing.T) {
	got, ok := resolveZillaManifestURL("https://player.zilla-networks.com/play/851cb91f6f2f43b2efaee829e5be6e28")
	if !ok {
		t.Fatal("expected Zilla play URL to produce a manifest URL")
	}

	want := "https://player.zilla-networks.com/m3u8/851cb91f6f2f43b2efaee829e5be6e28"
	if got != want {
		t.Fatalf("expected manifest URL %q, got %q", want, got)
	}
}
