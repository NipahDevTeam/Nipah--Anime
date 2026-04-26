package metadata

import "testing"

func BenchmarkCleanTitle(b *testing.B) {
	samples := []string{
		"[SubsPlease] Sousou no Frieren - 01 (1080p) [A1B2C3D4]",
		"[Trix] Dan Da Dan S01E07 1080p WEB-DL AAC2.0 AVC",
		"[Nipah] Kusuriya_no_Hitorigoto_(01-24)_[BD_1080p]",
	}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		for _, sample := range samples {
			if cleanTitle(sample) == "" {
				b.Fatal("cleanTitle returned empty string")
			}
		}
	}
}

func BenchmarkRequestCacheKey(b *testing.B) {
	payload := []byte(`{"query":"query($search:String){Page(page:1,perPage:5){media(search:$search,type:ANIME){id title{romaji english native}}}}","variables":{"search":"Frieren"}}`)

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		key := requestCacheKey("POST", anilistEndpoint, payload)
		if key == "" {
			b.Fatal("expected non-empty request cache key")
		}
	}
}
