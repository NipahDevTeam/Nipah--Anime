package main

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/sourcegraph/conc/pool"

	cachepkg "miruro/backend/cache"
	"miruro/backend/db"
	"miruro/backend/extensions"
	"miruro/backend/metadata"
)

const unresolvedMangaIdentityTTL = 18 * time.Hour
const maxResolvedSearchResults = 6
const minCanonicalMangaMatchConfidence = 0.78
const fastResolveCandidateBudget = 3

var mangaSourceIDsByLang = map[string][]string{
	"es": {"m440-es", "senshimanga-es", "mangaoni-es"},
	"en": {"weebcentral-en", "templetoons-en", "mangapill-en", "mangafire-en"},
}

type mangaIdentityResolution struct {
	AniListID        int
	MalID            int
	CanonicalTitle   string
	CanonicalEnglish string
	CoverURL         string
	BannerImage      string
	Description      string
	Year             int
	Status           string
	Chapters         int
	Volumes          int
	Format           string
	CountryOfOrigin  string
	MatchConfidence  float64
	InMangaList      bool
	MangaListStatus  string
	ChaptersRead     int
}

func normalizeMangaSearchLang(lang string) string {
	if strings.EqualFold(strings.TrimSpace(lang), "en") {
		return "en"
	}
	return "es"
}

func (a *App) availableMangaSourceIDs(lang string) []string {
	normalizedLang := normalizeMangaSearchLang(lang)
	candidates := append([]string(nil), mangaSourceIDsByLang[normalizedLang]...)
	out := make([]string, 0, len(candidates))
	seen := map[string]struct{}{}
	for _, sourceID := range candidates {
		if _, ok := seen[sourceID]; ok {
			continue
		}
		seen[sourceID] = struct{}{}
		if a.registry != nil {
			if _, err := a.registry.GetManga(sourceID); err != nil {
				continue
			}
		}
		out = append(out, sourceID)
	}
	return out
}

func (a *App) buildCanonicalMangaResult(meta *metadata.AniListMangaMetadata) map[string]interface{} {
	resolved := a.buildResolvedMangaIdentity(meta, 1)
	if resolved == nil {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"id":                resolved.AniListID,
		"anilist_id":        resolved.AniListID,
		"mal_id":            resolved.MalID,
		"title":             resolved.CanonicalTitle,
		"title_english":     resolved.CanonicalEnglish,
		"title_romaji":      meta.TitleRomaji,
		"title_native":      meta.TitleNative,
		"synonyms":          meta.Synonyms,
		"cover_url":         resolved.CoverURL,
		"banner_url":        resolved.BannerImage,
		"description":       resolved.Description,
		"year":              resolved.Year,
		"status":            resolved.Status,
		"format":            resolved.Format,
		"country_of_origin": resolved.CountryOfOrigin,
		"genres":            meta.Genres,
		"in_manga_list":     resolved.InMangaList,
		"manga_list_status": resolved.MangaListStatus,
		"chapters_read":     resolved.ChaptersRead,
		"chapters_total":    resolved.Chapters,
		"volumes_total":     resolved.Volumes,
		"match_confidence":  1.0,
	}
}

func (a *App) defaultMangaSourceForLang(lang string) string {
	if normalizeMangaSearchLang(lang) == "en" {
		return "weebcentral-en"
	}
	return "m440-es"
}

func prefersEnglishMangaSearch(meta *metadata.AniListMangaMetadata) bool {
	if meta == nil {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(meta.Format), "MANHWA") {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(meta.CountryOfOrigin), "KR")
}

func (a *App) resolveOnlineMangaIdentity(sourceID, sourceMangaID, sourceTitle, sourceCover string, year int) (*mangaIdentityResolution, error) {
	if a.db == nil || a.metadata == nil || sourceID == "" || sourceMangaID == "" {
		return nil, nil
	}

	cacheKey := fmt.Sprintf("manga:identity:%s:%s:%d", sourceID, sourceMangaID, year)
	return cachepkg.RememberJSON(cachepkg.Global(), cacheKey, 30*time.Minute, func() (*mangaIdentityResolution, error) {
		return a.resolveOnlineMangaIdentityUncached(sourceID, sourceMangaID, sourceTitle, sourceCover, year)
	})
}

func (a *App) resolveOnlineMangaIdentityUncached(sourceID, sourceMangaID, sourceTitle, sourceCover string, year int) (*mangaIdentityResolution, error) {
	return a.resolveOnlineMangaIdentityWithNeedles(sourceID, sourceMangaID, sourceTitle, sourceCover, year, nil)
}

func (a *App) resolveOnlineMangaIdentityWithNeedles(sourceID, sourceMangaID, sourceTitle, sourceCover string, year int, extraNeedles []string) (*mangaIdentityResolution, error) {
	if existing, err := a.db.GetOnlineMangaSourceMap(sourceID, sourceMangaID); err == nil && existing != nil {
		if existing.AniListID > 0 {
			meta, err := a.metadata.GetAniListMangaByID(existing.AniListID)
			if err == nil && meta != nil {
				return a.buildResolvedMangaIdentity(meta, existing.Confidence), nil
			}
		}
		if time.Since(existing.LastSeenAt) < unresolvedMangaIdentityTTL {
			return nil, nil
		}
	}

	candidates := buildMangaSearchCandidates(sourceTitle, sourceMangaID)
	candidates = append(candidates, extraNeedles...)
	meta, matchedTitle, confidence, err := a.matchAniListMangaCandidates(candidates, year)
	if err != nil {
		return nil, err
	}

	mapEntry := db.OnlineMangaSourceMap{
		SourceID:      sourceID,
		SourceMangaID: sourceMangaID,
		SourceTitle:   strings.TrimSpace(sourceTitle),
		Confidence:    confidence,
	}
	if meta != nil {
		mapEntry.AniListID = meta.AniListID
		mapEntry.MatchedTitle = matchedTitle
	}
	_ = a.db.UpsertOnlineMangaSourceMap(mapEntry)

	if meta == nil {
		return nil, nil
	}
	return a.buildResolvedMangaIdentity(meta, confidence), nil
}

func (a *App) buildResolvedMangaIdentity(meta *metadata.AniListMangaMetadata, confidence float64) *mangaIdentityResolution {
	if meta == nil {
		return nil
	}
	resolved := &mangaIdentityResolution{
		AniListID:        meta.AniListID,
		MalID:            meta.MalID,
		CanonicalTitle:   firstNonEmpty(meta.TitleEnglish, meta.TitleRomaji, meta.TitleNative),
		CanonicalEnglish: meta.TitleEnglish,
		CoverURL:         firstNonEmpty(meta.CoverLarge, meta.CoverMedium),
		BannerImage:      meta.BannerImage,
		Description:      meta.Description,
		Year:             meta.Year,
		Status:           meta.Status,
		Chapters:         meta.Chapters,
		Volumes:          meta.Volumes,
		Format:           meta.Format,
		CountryOfOrigin:  meta.CountryOfOrigin,
		MatchConfidence:  confidence,
	}
	if entry, err := a.db.GetMangaListEntryByAniListID(meta.AniListID); err == nil && entry != nil {
		resolved.InMangaList = true
		resolved.MangaListStatus = entry.Status
		resolved.ChaptersRead = entry.ChaptersRead
	}
	return resolved
}

func (a *App) matchAniListMangaCandidates(candidates []string, sourceYear int) (*metadata.AniListMangaMetadata, string, float64, error) {
	if len(candidates) == 0 {
		return nil, "", 0, nil
	}

	type candidateResult struct {
		meta         metadata.AniListMangaMetadata
		matchedTitle string
		score        int
	}

	needles := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		if normalized := normalizeMangaIdentityText(candidate); normalized != "" {
			needles = append(needles, normalized)
		}
	}
	if len(needles) == 0 {
		return nil, "", 0, nil
	}

	queryLimit := len(candidates)
	if queryLimit > 3 {
		queryLimit = 3
	}

	seen := map[int]candidateResult{}
	for _, query := range candidates[:queryLimit] {
		entries, err := a.metadata.SearchAniListMangaEntries(query)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			score, matchedTitle := scoreAniListMangaMatch(entry, needles, sourceYear)
			if current, ok := seen[entry.AniListID]; !ok || score > current.score {
				seen[entry.AniListID] = candidateResult{
					meta:         entry,
					matchedTitle: matchedTitle,
					score:        score,
				}
			}
		}
	}

	if len(seen) == 0 {
		return nil, "", 0, nil
	}

	ranked := make([]candidateResult, 0, len(seen))
	for _, item := range seen {
		ranked = append(ranked, item)
	}
	sort.Slice(ranked, func(i, j int) bool {
		return ranked[i].score > ranked[j].score
	})

	best := ranked[0]
	if best.score < 78 {
		return nil, "", float64(best.score) / 100, nil
	}

	meta := best.meta
	return &meta, best.matchedTitle, float64(best.score) / 100, nil
}

func (a *App) resolveMangaSearchResults(sourceID string, results []map[string]interface{}) []map[string]interface{} {
	if len(results) == 0 {
		return results
	}

	resolvedResults := make([]map[string]interface{}, len(results))
	resolveLimit := maxResolvedSearchResultsForSource(sourceID, len(results))

	for i := resolveLimit; i < len(results); i++ {
		resolvedResults[i] = cloneMap(results[i])
		applyResolvedMangaFields(resolvedResults[i], nil)
	}

	p := pool.New().WithMaxGoroutines(4)
	for i := 0; i < resolveLimit; i++ {
		index := i
		p.Go(func() {
			item := cloneMap(results[index])
			sourceMangaID, _ := item["id"].(string)
			title, _ := item["title"].(string)
			sourceCover, _ := item["cover_url"].(string)
			year, _ := item["year"].(int)
			if year == 0 {
				if floatYear, ok := item["year"].(float64); ok {
					year = int(floatYear)
				}
			}

			resolved, err := a.resolveOnlineMangaIdentity(sourceID, sourceMangaID, title, sourceCover, year)
			if err == nil {
				applyResolvedMangaFields(item, resolved)
			}
			resolvedResults[index] = item
		})
	}
	p.Wait()

	for i := range resolvedResults {
		if resolvedResults[i] == nil {
			resolvedResults[i] = results[i]
		}
	}
	return resolvedResults
}

func maxResolvedSearchResultsForSource(sourceID string, count int) int {
	if count <= 0 {
		return 0
	}
	limit := count
	if limit > maxResolvedSearchResults {
		limit = maxResolvedSearchResults
	}
	switch strings.TrimSpace(sourceID) {
	case "m440-es", "weebcentral-en":
		if limit > 0 {
			return 0
		}
	case "templetoons-en", "mangapill-en", "mangafire-en", "senshimanga-es", "mangaoni-es":
		if limit > 2 {
			return 2
		}
	}
	return limit
}

func applyResolvedMangaFields(item map[string]interface{}, resolved *mangaIdentityResolution) {
	if item == nil {
		return
	}

	sourceCover, _ := item["cover_url"].(string)
	sourceDescription, _ := item["description"].(string)
	year, _ := item["year"].(int)
	if year == 0 {
		if floatYear, ok := item["year"].(float64); ok {
			year = int(floatYear)
		}
	}

	resolvedCover := sourceCover
	resolvedDescription := sourceDescription
	resolvedYear := year

	if resolved != nil {
		if resolved.CoverURL != "" {
			resolvedCover = resolved.CoverURL
		}
		if resolved.Description != "" {
			resolvedDescription = resolved.Description
		}
		if resolved.Year > 0 {
			resolvedYear = resolved.Year
		}
		item["anilist_id"] = resolved.AniListID
		item["mal_id"] = resolved.MalID
		item["canonical_title"] = resolved.CanonicalTitle
		item["canonical_title_english"] = resolved.CanonicalEnglish
		item["resolved_banner_url"] = resolved.BannerImage
		item["resolved_status"] = resolved.Status
		item["resolved_format"] = resolved.Format
		item["resolved_country_of_origin"] = resolved.CountryOfOrigin
		item["anilist_match_confidence"] = resolved.MatchConfidence
		item["in_manga_list"] = resolved.InMangaList
		item["manga_list_status"] = resolved.MangaListStatus
		item["chapters_read"] = resolved.ChaptersRead
		item["chapters_total"] = resolved.Chapters
		item["volumes_total"] = resolved.Volumes
	} else {
		item["anilist_id"] = 0
		item["mal_id"] = 0
		item["canonical_title"] = ""
		item["canonical_title_english"] = ""
		item["resolved_banner_url"] = ""
		item["resolved_status"] = ""
		item["anilist_match_confidence"] = 0.0
		item["in_manga_list"] = false
		item["manga_list_status"] = ""
		item["chapters_read"] = 0
		item["chapters_total"] = 0
		item["volumes_total"] = 0
	}

	item["resolved_cover_url"] = resolvedCover
	item["resolved_description"] = resolvedDescription
	item["resolved_year"] = resolvedYear
}

func buildMangaSearchCandidates(sourceTitle, sourceMangaID string) []string {
	seen := map[string]struct{}{}
	var out []string

	push := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}

	push(sourceTitle)
	push(cleanMangaIdentityTitle(sourceTitle))

	slug := sourceMangaID
	if slash := strings.LastIndex(slug, "/"); slash >= 0 {
		slug = slug[slash+1:]
	}
	slug = strings.TrimSpace(strings.Trim(slug, "/"))
	slug = strings.ReplaceAll(slug, "-", " ")
	slug = strings.ReplaceAll(slug, "_", " ")
	push(slug)
	push(cleanMangaIdentityTitle(slug))
	return out
}

func cleanMangaIdentityTitle(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, ":", " ")
	value = strings.ReplaceAll(value, "  ", " ")
	value = strings.Trim(value, "-_. ")
	return strings.Join(strings.Fields(value), " ")
}

func normalizeMangaIdentityText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	lastSpace := false
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
			lastSpace = false
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastSpace = false
		default:
			if !lastSpace {
				builder.WriteByte(' ')
				lastSpace = true
			}
		}
	}
	return strings.TrimSpace(builder.String())
}

func compactMangaIdentityText(value string) string {
	return strings.ReplaceAll(normalizeMangaIdentityText(value), " ", "")
}

func tokenizeMangaIdentityText(value string) []string {
	parts := strings.Fields(normalizeMangaIdentityText(value))
	tokens := make([]string, 0, len(parts))
	for _, part := range parts {
		if len(part) >= 2 {
			tokens = append(tokens, part)
		}
	}
	return tokens
}

func scoreAniListMangaMatch(entry metadata.AniListMangaMetadata, needles []string, sourceYear int) (int, string) {
	candidateTitles := []string{
		entry.TitleEnglish,
		entry.TitleRomaji,
		entry.TitleNative,
	}
	candidateTitles = append(candidateTitles, entry.Synonyms...)

	bestScore := 0
	bestTitle := firstNonEmpty(entry.TitleEnglish, entry.TitleRomaji, entry.TitleNative)

	for _, title := range candidateTitles {
		titleNorm := normalizeMangaIdentityText(title)
		if titleNorm == "" {
			continue
		}
		score := 0
		titleCompact := compactMangaIdentityText(title)
		titleTokens := tokenizeMangaIdentityText(title)
		for _, needle := range needles {
			needleCompact := strings.ReplaceAll(needle, " ", "")
			if titleNorm == needle {
				score = maxInt(score, 100)
				continue
			}
			if titleCompact != "" && needleCompact != "" {
				if titleCompact == needleCompact {
					score = maxInt(score, 98)
				} else if strings.HasPrefix(titleCompact, needleCompact) || strings.HasPrefix(needleCompact, titleCompact) {
					score = maxInt(score, 86)
				} else if strings.Contains(titleCompact, needleCompact) || strings.Contains(needleCompact, titleCompact) {
					score = maxInt(score, 74)
				}
			}
			if strings.HasPrefix(titleNorm, needle) || strings.HasPrefix(needle, titleNorm) {
				score = maxInt(score, 82)
			}
			if strings.Contains(titleNorm, needle) || strings.Contains(needle, titleNorm) {
				score = maxInt(score, 68)
			}

			needleTokens := strings.Fields(needle)
			if len(needleTokens) > 0 && len(titleTokens) > 0 {
				shared := 0
				for _, token := range needleTokens {
					for _, titleToken := range titleTokens {
						if token == titleToken {
							shared++
							break
						}
					}
				}
				ratio := float64(shared) / math.Max(float64(len(needleTokens)), float64(len(titleTokens)))
				if shared >= 3 && ratio >= 0.5 {
					score = maxInt(score, 76)
				} else if shared >= 2 && ratio >= 0.4 {
					score = maxInt(score, 66)
				}
			}
		}

		if sourceYear > 0 && entry.Year > 0 && sourceYear == entry.Year {
			score += 6
		}
		if score > bestScore {
			bestScore = score
			bestTitle = title
		}
	}

	return bestScore, bestTitle
}

func cloneMap(value map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(value))
	for key, item := range value {
		out[key] = item
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func readCachedJSON[T any](key string) (T, bool) {
	var zero T
	raw, ok := cachepkg.Global().GetBytes(key)
	if !ok {
		return zero, false
	}
	var value T
	if err := json.Unmarshal(raw, &value); err != nil {
		return zero, false
	}
	return value, true
}

func writeCachedJSON(key string, ttl time.Duration, value interface{}) {
	raw, err := json.Marshal(value)
	if err != nil {
		return
	}
	cachepkg.Global().SetBytes(key, raw, ttl)
}

func searchMangaSourceCached(src extensions.MangaSource, sourceID, query, lang string, hitTTL, missTTL time.Duration) ([]extensions.SearchResult, error) {
	normalizedLang := normalizeMangaSearchLang(lang)
	cacheKey := fmt.Sprintf("manga:search:%s:%s:%s", sourceID, normalizedLang, strings.ToLower(strings.TrimSpace(query)))
	if cached, ok := readCachedJSON[[]extensions.SearchResult](cacheKey); ok {
		return cached, nil
	}
	results, err := src.Search(query, extensions.Language(normalizedLang))
	if err != nil {
		return nil, err
	}
	ttl := hitTTL
	if len(results) == 0 {
		ttl = missTTL
	}
	writeCachedJSON(cacheKey, ttl, results)
	return results, nil
}

func fastResolveCandidates(meta *metadata.AniListMangaMetadata) []string {
	candidates := buildAniListMangaSearchCandidates("", meta)
	if len(candidates) > fastResolveCandidateBudget {
		return candidates[:fastResolveCandidateBudget]
	}
	return candidates
}

func (a *App) mangaIdentityPayload(sourceID, sourceMangaID, sourceTitle, sourceCover string, year int) map[string]interface{} {
	resolved, err := a.resolveOnlineMangaIdentity(sourceID, sourceMangaID, sourceTitle, sourceCover, year)
	if err != nil || resolved == nil {
		return map[string]interface{}{
			"anilist_id":               0,
			"mal_id":                   0,
			"canonical_title":          "",
			"canonical_title_english":  "",
			"resolved_cover_url":       sourceCover,
			"resolved_banner_url":      "",
			"resolved_description":     "",
			"resolved_year":            year,
			"resolved_status":          "",
			"anilist_match_confidence": 0.0,
			"in_manga_list":            false,
			"manga_list_status":        "",
			"chapters_total":           0,
			"volumes_total":            0,
		}
	}

	return map[string]interface{}{
		"anilist_id":               resolved.AniListID,
		"mal_id":                   resolved.MalID,
		"canonical_title":          resolved.CanonicalTitle,
		"canonical_title_english":  resolved.CanonicalEnglish,
		"resolved_cover_url":       firstNonEmpty(resolved.CoverURL, sourceCover),
		"resolved_banner_url":      resolved.BannerImage,
		"resolved_description":     resolved.Description,
		"resolved_year":            chooseResolvedInt(resolved.Year, year),
		"resolved_status":          resolved.Status,
		"anilist_match_confidence": resolved.MatchConfidence,
		"in_manga_list":            resolved.InMangaList,
		"manga_list_status":        resolved.MangaListStatus,
		"chapters_total":           resolved.Chapters,
		"volumes_total":            resolved.Volumes,
	}
}

func chooseResolvedInt(primary, fallback int) int {
	if primary > 0 {
		return primary
	}
	return fallback
}

func buildAniListMangaSearchCandidates(query string, meta *metadata.AniListMangaMetadata) []string {
	out := make([]string, 0, 14)
	seen := map[string]struct{}{}
	push := func(value string) {
		for _, variant := range buildExpandedMangaTitleVariants(value) {
			value = cleanMangaIdentityTitle(variant)
			if value == "" {
				continue
			}
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
			out = append(out, value)
		}
	}

	push(query)
	if meta != nil {
		if prefersEnglishMangaSearch(meta) {
			push(meta.TitleEnglish)
			for _, synonym := range meta.Synonyms {
				push(synonym)
				if len(out) >= 14 {
					break
				}
			}
			push(meta.TitleRomaji)
			push(meta.TitleNative)
		} else {
			push(meta.TitleEnglish)
			push(meta.TitleRomaji)
			push(meta.TitleNative)
			for _, synonym := range meta.Synonyms {
				push(synonym)
				if len(out) >= 14 {
					break
				}
			}
		}
	}
	return out
}

func buildCanonicalMangaQueryCandidates(query string) []string {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	push := func(value string) {
		for _, variant := range buildExpandedMangaTitleVariants(value) {
			value = cleanMangaIdentityTitle(variant)
			if value == "" {
				continue
			}
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
			out = append(out, value)
		}
	}

	push(query)
	push(strings.ReplaceAll(query, ":", " "))
	push(strings.ReplaceAll(strings.ReplaceAll(query, "-", " "), "_", " "))
	return out
}

func buildExpandedMangaTitleVariants(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	push := func(candidate string) {
		candidate = cleanMangaIdentityTitle(candidate)
		if candidate == "" {
			return
		}
		if _, ok := seen[candidate]; ok {
			return
		}
		seen[candidate] = struct{}{}
		out = append(out, candidate)
	}

	push(value)
	push(strings.ReplaceAll(strings.ReplaceAll(value, "-", " "), "_", " "))
	push(strings.ReplaceAll(value, ":", " "))
	push(strings.TrimSpace(strings.Split(value, "(")[0]))

	for _, separator := range []string{":", " - ", " — ", " – "} {
		parts := strings.Split(value, separator)
		if len(parts) < 2 {
			continue
		}
		push(parts[0])
		push(parts[len(parts)-1])
	}

	for _, separator := range []string{",", " / "} {
		parts := strings.Split(value, separator)
		if len(parts) < 2 {
			continue
		}
		last := strings.TrimSpace(parts[len(parts)-1])
		if wordCount := len(strings.Fields(last)); wordCount > 0 && wordCount <= 5 {
			push(last)
		}
		first := strings.TrimSpace(parts[0])
		if wordCount := len(strings.Fields(first)); wordCount > 1 && wordCount <= 8 {
			push(first)
		}
	}
	return out
}

func (a *App) SearchMangaGlobal(query, lang string) ([]map[string]interface{}, error) {
	started := time.Now()
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}
	normalizedQuery := strings.TrimSpace(query)
	if normalizedQuery == "" {
		return []map[string]interface{}{}, nil
	}

	combined := make([]metadata.AniListMangaMetadata, 0, 12)
	seen := map[int]struct{}{}
	var lastErr error
	var retryableFailure bool
	for _, candidate := range buildCanonicalMangaQueryCandidates(normalizedQuery) {
		results, err := a.metadata.SearchAniListMangaEntries(candidate)
		if err != nil {
			if metadata.IsRetryableAniListError(err) {
				retryableFailure = true
				log.Warn().Err(err).Str("query", normalizedQuery).Str("candidate", candidate).Msg("AniList manga search transient failure")
			} else {
				log.Warn().Err(err).Str("query", normalizedQuery).Str("candidate", candidate).Msg("AniList manga search failed")
			}
			lastErr = err
			continue
		}
		for _, item := range results {
			if _, ok := seen[item.AniListID]; ok {
				continue
			}
			seen[item.AniListID] = struct{}{}
			combined = append(combined, item)
			if len(combined) >= 12 {
				break
			}
		}
		if len(combined) >= 12 {
			break
		}
	}
	if len(combined) == 0 && lastErr != nil {
		if retryableFailure {
			log.Warn().Str("query", normalizedQuery).Msg("SearchMangaGlobal returning empty results after transient AniList failure")
			return []map[string]interface{}{}, nil
		}
		return nil, lastErr
	}

	out := make([]map[string]interface{}, 0, len(combined))
	for _, item := range combined {
		out = append(out, a.buildCanonicalMangaResult(&item))
		if len(out) >= 12 {
			break
		}
	}
	log.Debug().Str("query", normalizedQuery).Str("lang", normalizeMangaSearchLang(lang)).Int("results", len(out)).Dur("took", time.Since(started)).Msg("SearchMangaGlobal")
	return out, nil
}

func (a *App) GetMangaSourceMatches(anilistID int, lang string) ([]map[string]interface{}, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not ready")
	}
	sourceIDs := a.availableMangaSourceIDs(lang)
	cached, err := a.db.GetOnlineMangaSourceMapsByAniListID(anilistID)
	if err != nil {
		return nil, err
	}
	cachedBySource := map[string]db.OnlineMangaSourceMap{}
	for _, item := range cached {
		if _, exists := cachedBySource[item.SourceID]; exists {
			continue
		}
		cachedBySource[item.SourceID] = item
	}

	out := make([]map[string]interface{}, 0, len(sourceIDs))
	defaultSource := a.defaultMangaSourceForLang(lang)
	for _, sourceID := range sourceIDs {
		item := map[string]interface{}{
			"source_id":       sourceID,
			"source_name":     a.mangaSourceLabel(sourceID),
			"default":         sourceID == defaultSource,
			"source_manga_id": "",
			"source_title":    "",
			"matched_title":   "",
			"confidence":      0.0,
			"status":          "idle",
		}
		if cachedMatch, ok := cachedBySource[sourceID]; ok && cachedMatch.AniListID == anilistID {
			item["source_manga_id"] = cachedMatch.SourceMangaID
			item["source_title"] = cachedMatch.SourceTitle
			item["matched_title"] = cachedMatch.MatchedTitle
			item["confidence"] = cachedMatch.Confidence
			item["status"] = "ready"
		}
		out = append(out, item)
	}
	return out, nil
}

func (a *App) ResolveMangaSourceForAniList(sourceID string, anilistID int, lang string) (map[string]interface{}, error) {
	cacheKey := fmt.Sprintf("manga:source-resolve:%s:%d:%s", sourceID, anilistID, normalizeMangaSearchLang(lang))
	if cached, ok := readCachedJSON[map[string]interface{}](cacheKey); ok {
		return cached, nil
	}
	if a.metadata == nil {
		return nil, fmt.Errorf("metadata not initialized")
	}

	if a.db != nil {
		if cached, err := a.db.GetPreferredOnlineMangaSourceMap(sourceID, anilistID); err == nil && cached != nil && cached.Confidence >= minCanonicalMangaMatchConfidence {
			result := map[string]interface{}{
				"source_id":       sourceID,
				"source_name":     a.mangaSourceLabel(sourceID),
				"source_manga_id": cached.SourceMangaID,
				"source_title":    cached.SourceTitle,
				"matched_title":   cached.MatchedTitle,
				"confidence":      cached.Confidence,
				"status":          "ready",
			}
			writeCachedJSON(cacheKey, 15*time.Minute, result)
			return result, nil
		}
	}

	meta, err := a.metadata.GetAniListMangaByID(anilistID)
	if err != nil {
		if metadata.IsRetryableAniListError(err) {
			log.Warn().Err(err).Str("source", sourceID).Int("anilist_id", anilistID).Str("lang", lang).Msg("ResolveMangaSourceForAniList metadata transient failure")
			result := map[string]interface{}{
				"source_id":       sourceID,
				"source_name":     a.mangaSourceLabel(sourceID),
				"source_manga_id": "",
				"source_title":    "",
				"matched_title":   "",
				"confidence":      0.0,
				"status":          "unresolved",
			}
			writeCachedJSON(cacheKey, 45*time.Second, result)
			return result, nil
		}
		return nil, err
	}
	if meta == nil {
		return nil, fmt.Errorf("manga not found")
	}

	if a.registry == nil {
		return nil, fmt.Errorf("registry not initialized")
	}
	src, err := a.registry.GetManga(sourceID)
	if err != nil {
		return nil, err
	}

	searchLang := normalizeMangaSearchLang(lang)
	best := map[string]interface{}{
		"source_id":       sourceID,
		"source_name":     a.mangaSourceLabel(sourceID),
		"source_manga_id": "",
		"source_title":    "",
		"matched_title":   "",
		"confidence":      0.0,
		"status":          "not_found",
	}
	searchCandidates := fastResolveCandidates(meta)
	log.Debug().
		Str("source", sourceID).
		Int("anilist_id", anilistID).
		Strs("candidates", searchCandidates).
		Msg("ResolveMangaSourceForAniList candidates")
	for _, candidate := range searchCandidates {
		candidateStarted := time.Now()
		results, err := searchMangaSourceCached(src, sourceID, candidate, searchLang, 10*time.Minute, 45*time.Second)
		if err != nil {
			log.Warn().Err(err).Str("source", sourceID).Int("anilist_id", anilistID).Str("candidate", candidate).Msg("ResolveMangaSourceForAniList source search failed")
			continue
		}
		if len(results) == 0 {
			log.Debug().
				Str("source", sourceID).
				Int("anilist_id", anilistID).
				Str("candidate", candidate).
				Dur("took", time.Since(candidateStarted)).
				Msg("ResolveMangaSourceForAniList no source hits")
		}
		verificationNeedles := append(buildAniListMangaSearchCandidates(candidate, meta), candidate)
		for _, item := range results {
			resolved, err := a.resolveOnlineMangaIdentityWithNeedles(sourceID, item.ID, item.Title, item.CoverURL, item.Year, verificationNeedles)
			if err != nil || resolved == nil || resolved.AniListID != anilistID || resolved.MatchConfidence < minCanonicalMangaMatchConfidence {
				continue
			}
			if resolved.MatchConfidence <= best["confidence"].(float64) {
				continue
			}
			best = map[string]interface{}{
				"source_id":       sourceID,
				"source_name":     a.mangaSourceLabel(sourceID),
				"source_manga_id": item.ID,
				"source_title":    item.Title,
				"matched_title":   resolved.CanonicalTitle,
				"confidence":      resolved.MatchConfidence,
				"status":          "ready",
			}
			log.Debug().
				Str("source", sourceID).
				Int("anilist_id", anilistID).
				Str("candidate", candidate).
				Str("source_title", item.Title).
				Float64("confidence", resolved.MatchConfidence).
				Dur("took", time.Since(candidateStarted)).
				Msg("ResolveMangaSourceForAniList matched")
			break
		}
		if best["status"] == "ready" {
			writeCachedJSON(cacheKey, 15*time.Minute, best)
			return best, nil
		}
	}

	writeCachedJSON(cacheKey, 30*time.Second, best)
	return best, nil
}

func (a *App) GetMangaChaptersForAniListSource(sourceID string, anilistID int, lang string) (map[string]interface{}, error) {
	cacheKey := fmt.Sprintf("manga:anilist-chapters:%s:%d:%s", sourceID, anilistID, normalizeMangaSearchLang(lang))
	if cached, ok := readCachedJSON[map[string]interface{}](cacheKey); ok {
		return cached, nil
	}
	match, err := a.ResolveMangaSourceForAniList(sourceID, anilistID, lang)
	if err != nil {
		return nil, err
	}
	if match == nil || match["status"] != "ready" {
		result := map[string]interface{}{
			"source":   match,
			"chapters": []map[string]interface{}{},
		}
		writeCachedJSON(cacheKey, 45*time.Second, result)
		return result, nil
	}
	sourceMangaID, _ := match["source_manga_id"].(string)
	chapters, err := a.GetMangaChaptersSource(sourceID, sourceMangaID, lang)
	if err != nil {
		return nil, err
	}
	result := map[string]interface{}{
		"source":   match,
		"chapters": chapters,
	}
	if len(chapters) == 0 {
		writeCachedJSON(cacheKey, 45*time.Second, result)
	} else {
		writeCachedJSON(cacheKey, 15*time.Minute, result)
	}
	return result, nil
}

func (a *App) GetHomeMangaRecommendations(seedAniListIDs []int, excludeAniListIDs []int, lang string) ([]map[string]interface{}, error) {
	seeds := uniqueSortedPositiveInts(seedAniListIDs)
	excludes := uniqueSortedPositiveInts(excludeAniListIDs)
	if len(seeds) == 0 {
		return []map[string]interface{}{}, nil
	}

	cacheKey := fmt.Sprintf("manga:home-recs:%s:%s:%s", joinPositiveInts(seeds), joinPositiveInts(excludes), normalizeMangaSearchLang(lang))
	return cachepkg.RememberJSON(cachepkg.Global(), cacheKey, 20*time.Minute, func() ([]map[string]interface{}, error) {
		if a.metadata == nil {
			return nil, fmt.Errorf("metadata not initialized")
		}

		seedPool := pool.NewWithResults[*metadata.AniListMangaMetadata]().WithMaxGoroutines(minInt(len(seeds), 4))
		for _, seedID := range seeds {
			seedID := seedID
			seedPool.Go(func() *metadata.AniListMangaMetadata {
				meta, err := a.metadata.GetAniListMangaByID(seedID)
				if err != nil || meta == nil {
					return nil
				}
				return meta
			})
		}

		genreCounts := map[string]int{}
		for _, meta := range seedPool.Wait() {
			if meta == nil {
				continue
			}
			for _, genre := range meta.Genres {
				genre = strings.TrimSpace(genre)
				if genre == "" {
					continue
				}
				genreCounts[genre]++
			}
		}
		if len(genreCounts) == 0 {
			return []map[string]interface{}{}, nil
		}

		type genreScore struct {
			Name  string
			Count int
		}
		rankedGenres := make([]genreScore, 0, len(genreCounts))
		for name, count := range genreCounts {
			rankedGenres = append(rankedGenres, genreScore{Name: name, Count: count})
		}
		sort.Slice(rankedGenres, func(i, j int) bool {
			if rankedGenres[i].Count == rankedGenres[j].Count {
				return rankedGenres[i].Name < rankedGenres[j].Name
			}
			return rankedGenres[i].Count > rankedGenres[j].Count
		})
		if len(rankedGenres) > 3 {
			rankedGenres = rankedGenres[:3]
		}

		excluded := map[int]struct{}{}
		for _, id := range seeds {
			excluded[id] = struct{}{}
		}
		for _, id := range excludes {
			excluded[id] = struct{}{}
		}

		recommendations := make([]map[string]interface{}, 0, 12)
		seen := map[int]struct{}{}
		for _, genre := range rankedGenres {
			items, _, err := a.metadata.DiscoverMangaEntries(genre.Name, 0, "POPULARITY_DESC", 1)
			if err != nil {
				continue
			}
			for _, item := range items {
				if item.AniListID <= 0 {
					continue
				}
				if _, skip := excluded[item.AniListID]; skip {
					continue
				}
				if _, exists := seen[item.AniListID]; exists {
					continue
				}
				seen[item.AniListID] = struct{}{}
				recommendations = append(recommendations, a.buildCanonicalMangaResult(&item))
				if len(recommendations) >= 12 {
					return recommendations, nil
				}
			}
		}

		return recommendations, nil
	})
}

func (a *App) mangaSourceLabel(sourceID string) string {
	if a.registry != nil {
		if src, err := a.registry.GetManga(sourceID); err == nil {
			return src.Name()
		}
	}
	switch sourceID {
	case "m440-es":
		return "M440"
	case "senshimanga-es":
		return "SenshiManga"
	case "mangaoni-es":
		return "MangaOni"
	case "weebcentral-en":
		return "WeebCentral"
	case "templetoons-en":
		return "TempleToons"
	case "mangapill-en":
		return "MangaPill"
	case "mangafire-en":
		return "MangaFire"
	default:
		return sourceID
	}
}

func uniqueSortedPositiveInts(values []int) []int {
	seen := map[int]struct{}{}
	out := make([]int, 0, len(values))
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Ints(out)
	return out
}

func joinPositiveInts(values []int) string {
	if len(values) == 0 {
		return ""
	}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, fmt.Sprintf("%d", value))
	}
	return strings.Join(parts, ",")
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (a *App) hydrateOnlineMangaHistoryEntry(entry db.WatchHistoryEntry) db.WatchHistoryEntry {
	if a == nil || a.metadata == nil {
		return entry
	}

	resolveFromMeta := func(meta *metadata.AniListMangaMetadata) {
		if meta == nil {
			return
		}
		resolved := a.buildResolvedMangaIdentity(meta, 1)
		if resolved == nil {
			return
		}
		entry.AniListID = resolved.AniListID
		entry.AnimeTitle = firstNonEmpty(resolved.CanonicalTitle, entry.AnimeTitle)
		entry.CoverURL = firstNonEmpty(resolved.CoverURL, entry.CoverURL)
		entry.BannerImage = firstNonEmpty(resolved.BannerImage, entry.BannerImage)
		if resolved.Format != "" {
			entry.MediaFormat = normalizeDashboardMangaFormat(resolved.Format)
		}
	}

	if entry.AniListID > 0 {
		if meta, err := a.metadata.GetAniListMangaByID(entry.AniListID); err == nil && meta != nil {
			resolveFromMeta(meta)
			return entry
		}
	}

	if a.db != nil && entry.SourceID != "" && entry.AnimeID != "" {
		if mapped, err := a.db.GetOnlineMangaSourceMap(entry.SourceID, entry.AnimeID); err == nil && mapped != nil && mapped.AniListID > 0 {
			entry.AniListID = mapped.AniListID
			if meta, metaErr := a.metadata.GetAniListMangaByID(mapped.AniListID); metaErr == nil && meta != nil {
				resolveFromMeta(meta)
				return entry
			}
		}
	}

	if entry.SourceID != "" && entry.AnimeID != "" && (entry.CoverURL == "" || strings.TrimSpace(entry.AnimeTitle) == "") {
		if resolved, err := a.resolveOnlineMangaIdentity(entry.SourceID, entry.AnimeID, entry.AnimeTitle, entry.CoverURL, 0); err == nil && resolved != nil {
			entry.AniListID = resolved.AniListID
			entry.AnimeTitle = firstNonEmpty(resolved.CanonicalTitle, entry.AnimeTitle)
			entry.CoverURL = firstNonEmpty(resolved.CoverURL, entry.CoverURL)
			entry.BannerImage = firstNonEmpty(resolved.BannerImage, entry.BannerImage)
			if resolved.Format != "" {
				entry.MediaFormat = normalizeDashboardMangaFormat(resolved.Format)
			}
		}
	}

	return entry
}

func (a *App) recordOnlineMangaReadResolved(sourceID, sourceMangaID, sourceTitle, sourceCover, chapterID string, chapterNum float64, chapterTitle string) error {
	if a.db == nil {
		return fmt.Errorf("db not ready")
	}

	sourceName := "Manga"
	if a.registry != nil {
		if src, err := a.registry.GetManga(sourceID); err == nil {
			sourceName = src.Name()
		}
	}

	resolved, _ := a.resolveOnlineMangaIdentity(sourceID, sourceMangaID, sourceTitle, sourceCover, 0)
	displayTitle := strings.TrimSpace(sourceTitle)
	coverURL := sourceCover
	bannerURL := ""
	anilistID := 0
	if resolved != nil {
		anilistID = resolved.AniListID
		displayTitle = firstNonEmpty(resolved.CanonicalTitle, displayTitle)
		coverURL = firstNonEmpty(resolved.CoverURL, sourceCover)
		bannerURL = resolved.BannerImage
	}
	if err := a.db.RecordOnlineMangaRead(db.OnlineMangaHistoryEntry{
		AniListID:        anilistID,
		SourceID:         sourceID,
		SourceName:       sourceName,
		SourceMangaID:    sourceMangaID,
		SourceMangaTitle: displayTitle,
		CoverURL:         coverURL,
		BannerImage:      bannerURL,
		ChapterID:        chapterID,
		ChapterNum:       chapterNum,
		ChapterTitle:     chapterTitle,
		Completed:        false,
	}); err != nil {
		return err
	}
	if anilistID > 0 {
		_ = a.db.PromoteOnlineMangaHistoryIdentity(sourceID, sourceMangaID, anilistID, displayTitle, coverURL, bannerURL)
	}
	chaptersRead := int(math.Floor(chapterNum))
	if chaptersRead <= 0 {
		chaptersRead = 1
	}
	a.ensurePassiveMangaTracked(anilistID, resolvedMalID(resolved), displayTitle, "", coverURL, bannerURL, chaptersRead, 0)
	return nil
}

func resolvedMalID(resolved *mangaIdentityResolution) int {
	if resolved == nil {
		return 0
	}
	return resolved.MalID
}
