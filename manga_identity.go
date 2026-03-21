package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"miruro/backend/db"
	"miruro/backend/metadata"
)

const unresolvedMangaIdentityTTL = 18 * time.Hour
const maxResolvedSearchResults = 6

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
	MatchConfidence  float64
	InMangaList      bool
	MangaListStatus  string
	ChaptersRead     int
}

func (a *App) resolveOnlineMangaIdentity(sourceID, sourceMangaID, sourceTitle, sourceCover string, year int) (*mangaIdentityResolution, error) {
	if a.db == nil || a.metadata == nil || sourceID == "" || sourceMangaID == "" {
		return nil, nil
	}

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
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	resolveLimit := len(results)
	if resolveLimit > maxResolvedSearchResults {
		resolveLimit = maxResolvedSearchResults
	}

	for i := range results {
		if i >= resolveLimit {
			resolvedResults[i] = cloneMap(results[i])
			applyResolvedMangaFields(resolvedResults[i], nil)
			continue
		}
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

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
		}(i)
	}
	wg.Wait()

	for i := range resolvedResults {
		if resolvedResults[i] == nil {
			resolvedResults[i] = results[i]
		}
	}
	return resolvedResults
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
	coverURL := sourceCover
	bannerURL := ""
	anilistID := 0
	if resolved != nil {
		anilistID = resolved.AniListID
		coverURL = firstNonEmpty(resolved.CoverURL, sourceCover)
		bannerURL = resolved.BannerImage
	}
	if err := a.db.RecordOnlineMangaRead(db.OnlineMangaHistoryEntry{
		AniListID:        anilistID,
		SourceID:         sourceID,
		SourceName:       sourceName,
		SourceMangaID:    sourceMangaID,
		SourceMangaTitle: sourceTitle,
		CoverURL:         coverURL,
		BannerImage:      bannerURL,
		ChapterID:        chapterID,
		ChapterNum:       chapterNum,
		ChapterTitle:     chapterTitle,
		Completed:        false,
	}); err != nil {
		return err
	}
	chaptersRead := int(math.Floor(chapterNum))
	if chaptersRead <= 0 {
		chaptersRead = 1
	}
	a.ensurePassiveMangaTracked(anilistID, resolvedMalID(resolved), sourceTitle, "", coverURL, bannerURL, chaptersRead, 0)
	return nil
}

func resolvedMalID(resolved *mangaIdentityResolution) int {
	if resolved == nil {
		return 0
	}
	return resolved.MalID
}
