package extensions

// This package defines the interfaces that community extensions must implement.
// The core application ships with ZERO scraping logic.
// All source-specific behavior lives in extensions, which are:
//   - Not bundled with Miruro
//   - Not maintained by Miruro's author
//   - Solely the responsibility of their respective authors
//
// This architecture is the same pattern used by Kodi, Stremio, and others.

// Language represents a BCP 47 language tag.
type Language string

const (
	LangSpanish    Language = "es"
	LangPortuguese Language = "pt"
	LangEnglish    Language = "en"
	LangJapanese   Language = "ja"
)

// Shared types

// SearchResult is a generic search result returned by any source extension.
type SearchResult struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	CoverURL    string     `json:"cover_url,omitempty"`
	Year        int        `json:"year,omitempty"`
	Description string     `json:"description,omitempty"`
	Languages   []Language `json:"languages,omitempty"`
}

// Episode represents a streamable anime episode.
type Episode struct {
	ID          string  `json:"id"`
	Number      float64 `json:"number"`
	Title       string  `json:"title,omitempty"`
	TitleES     string  `json:"title_es,omitempty"`
	Thumbnail   string  `json:"thumbnail,omitempty"`
	DurationSec int     `json:"duration_sec,omitempty"`
}

// StreamSource represents a playable stream URL for an episode.
// Miruro passes this to an external player; it never proxies the stream itself.
type StreamSource struct {
	URL       string          `json:"url"`
	Quality   string          `json:"quality,omitempty"` // "1080p", "720p", etc.
	Language  Language        `json:"language"`
	Audio     string          `json:"audio,omitempty"`   // "sub", "dub", "raw", etc.
	Referer   string          `json:"referer,omitempty"` // Required by some CDNs (e.g. kwik -> uwucdn)
	Cookie    string          `json:"cookie,omitempty"`  // Session cookies required by some browser-rendered hosts
	Subtitles []SubtitleTrack `json:"subtitles,omitempty"`
}

// SubtitleTrack is an external subtitle file URL.
type SubtitleTrack struct {
	URL      string   `json:"url"`
	Language Language `json:"language"`
	Format   string   `json:"format"` // "srt", "ass", "vtt"
}

// Chapter represents a manga chapter.
type Chapter struct {
	ID         string   `json:"id"`
	Number     float64  `json:"number"`
	VolumeNum  float64  `json:"volume_num,omitempty"`
	Title      string   `json:"title,omitempty"`
	TitleES    string   `json:"title_es,omitempty"`
	Language   Language `json:"language"`
	PageCount  int      `json:"page_count,omitempty"`
	UploadedAt string   `json:"uploaded_at,omitempty"`
	Locked     bool     `json:"locked,omitempty"`
	Price      int      `json:"price,omitempty"`
}

// PageSource is a URL to a manga page image.
type PageSource struct {
	URL   string `json:"url"`
	Index int    `json:"index"`
}

// Extension interfaces

// AnimeSource is the interface all anime extensions must implement.
type AnimeSource interface {
	// ID returns the unique identifier for this source (e.g., "animeflv-es")
	ID() string
	// Name returns the human-readable name (e.g., "AnimeFLV (Espanol)")
	Name() string
	// Languages returns the list of languages this source supports
	Languages() []Language

	// Search finds anime matching the query in the given language
	Search(query string, lang Language) ([]SearchResult, error)
	// GetEpisodes returns the episode list for a given anime ID
	GetEpisodes(animeID string) ([]Episode, error)
	// GetStreamSources returns available stream URLs for an episode
	// Miruro will pass the chosen URL directly to an external player
	GetStreamSources(episodeID string) ([]StreamSource, error)
}

// AnimeAudioVariantSource is an optional capability for anime providers that
// can report whether a title exposes subbed and/or dubbed playback variants.
type AnimeAudioVariantSource interface {
	GetAudioVariants(animeID string, episodeID string) (map[string]bool, error)
}

// MangaSource is the interface all manga extensions must implement.
type MangaSource interface {
	ID() string
	Name() string
	Languages() []Language

	Search(query string, lang Language) ([]SearchResult, error)
	GetChapters(mangaID string, lang Language) ([]Chapter, error)
	// GetPages returns image URLs for a chapter
	// These URLs are loaded directly in the built-in reader
	GetPages(chapterID string) ([]PageSource, error)
}

// ExtensionMeta contains metadata about a registered extension.
type ExtensionMeta struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Version     string     `json:"version"`
	Author      string     `json:"author"`
	Type        string     `json:"type"` // "anime", "manga", "both"
	Languages   []Language `json:"languages"`
	SourceURL   string     `json:"source_url"`
	Description string     `json:"description"`
}
