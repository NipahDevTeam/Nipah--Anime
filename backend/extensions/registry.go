package extensions

import "fmt"

// Registry holds all registered anime and manga source extensions.
// The core app ships with zero sources — extensions register themselves.
type Registry struct {
	anime map[string]AnimeSource
	manga map[string]MangaSource
}

func NewRegistry() *Registry {
	return &Registry{
		anime: make(map[string]AnimeSource),
		manga: make(map[string]MangaSource),
	}
}

func (r *Registry) RegisterAnime(s AnimeSource) {
	r.anime[s.ID()] = s
}

func (r *Registry) RegisterManga(s MangaSource) {
	r.manga[s.ID()] = s
}

func (r *Registry) GetAnime(id string) (AnimeSource, error) {
	s, ok := r.anime[id]
	if !ok {
		return nil, fmt.Errorf("anime source not found: %s", id)
	}
	return s, nil
}

func (r *Registry) GetManga(id string) (MangaSource, error) {
	s, ok := r.manga[id]
	if !ok {
		return nil, fmt.Errorf("manga source not found: %s", id)
	}
	return s, nil
}

func (r *Registry) ListAnime() []AnimeSource {
	out := make([]AnimeSource, 0, len(r.anime))
	for _, s := range r.anime {
		out = append(out, s)
	}
	return out
}

func (r *Registry) ListManga() []MangaSource {
	out := make([]MangaSource, 0, len(r.manga))
	for _, s := range r.manga {
		out = append(out, s)
	}
	return out
}

// ListAllMeta returns metadata for all registered extensions for display in UI.
func (r *Registry) ListAllMeta() []ExtensionMeta {
	var out []ExtensionMeta
	for _, s := range r.anime {
		out = append(out, ExtensionMeta{
			ID:        s.ID(),
			Name:      s.Name(),
			Type:      "anime",
			Languages: s.Languages(),
		})
	}
	for _, s := range r.manga {
		out = append(out, ExtensionMeta{
			ID:        s.ID(),
			Name:      s.Name(),
			Type:      "manga",
			Languages: s.Languages(),
		})
	}
	return out
}
