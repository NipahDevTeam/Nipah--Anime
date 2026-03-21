package metadata

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"os"
	"strconv"
	"time"
)

// MAL XML export format
type malExport struct {
	XMLName xml.Name      `xml:"myanimelist"`
	Info    malMyInfo     `xml:"myinfo"`
	Anime   []malAnimeXML `xml:"anime"`
}

type malMyInfo struct {
	UserName string `xml:"user_name"`
}

type malAnimeXML struct {
	SeriesDBID     int    `xml:"series_animedb_id"`
	SeriesTitle    string `xml:"series_title"`
	SeriesType     string `xml:"series_type"`
	SeriesEpisodes int    `xml:"series_episodes"`
	WatchedEps     int    `xml:"my_watched_episodes"`
	Score          int    `xml:"my_score"`
	Status         string `xml:"my_status"`
	StartDate      string `xml:"my_start_date"`
	FinishDate     string `xml:"my_finish_date"`
}

// malXMLStatusToInternal maps MAL XML status strings to our internal status.
var malXMLStatusToInternal = map[string]string{
	"Watching":      "WATCHING",
	"Completed":     "COMPLETED",
	"On-Hold":       "ON_HOLD",
	"Dropped":       "DROPPED",
	"Plan to Watch": "PLANNING",
	// Numeric fallbacks (some exports use numbers)
	"1": "WATCHING",
	"2": "COMPLETED",
	"3": "ON_HOLD",
	"4": "DROPPED",
	"6": "PLANNING",
}

// ParseMALExportFile reads a MAL XML export file and returns anime entries.
func ParseMALExportFile(path string) ([]JikanAnimeEntry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("no se pudo leer el archivo: %w", err)
	}

	var export malExport
	if err := xml.Unmarshal(data, &export); err != nil {
		return nil, fmt.Errorf("formato XML inválido: %w", err)
	}

	if len(export.Anime) == 0 {
		return nil, fmt.Errorf("el archivo no contiene anime")
	}

	entries := make([]JikanAnimeEntry, 0, len(export.Anime))
	for _, a := range export.Anime {
		status := malXMLStatusToInternal[a.Status]
		if status == "" {
			// Try parsing as number
			status = malXMLStatusToInternal[strconv.Itoa(mustAtoi(a.Status))]
			if status == "" {
				status = "PLANNING"
			}
		}

		entries = append(entries, JikanAnimeEntry{
			MalID:           a.SeriesDBID,
			Title:           a.SeriesTitle,
			Status:          status,
			EpisodesWatched: a.WatchedEps,
			EpisodesTotal:   a.SeriesEpisodes,
			Score:           float64(a.Score),
		})
	}

	return entries, nil
}

// EnrichEntriesWithAniList fetches cover images and metadata from AniList using
// batch queries with idMal_in. Processes 50 entries per API call instead of 1.
// AniList CDN images load natively in Wails webview — no proxy needed.
func (m *Manager) EnrichEntriesWithAniList(entries []JikanAnimeEntry) []JikanAnimeEntry {
	// Build a map from MAL ID → index(es) in entries slice
	malIDToIndices := map[int][]int{}
	var allMalIDs []int
	for i, e := range entries {
		if e.MalID == 0 {
			continue
		}
		if _, exists := malIDToIndices[e.MalID]; !exists {
			allMalIDs = append(allMalIDs, e.MalID)
		}
		malIDToIndices[e.MalID] = append(malIDToIndices[e.MalID], i)
	}

	// Process in batches of 50 (AniList page limit)
	batchSize := 50
	for start := 0; start < len(allMalIDs); start += batchSize {
		end := start + batchSize
		if end > len(allMalIDs) {
			end = len(allMalIDs)
		}
		batch := allMalIDs[start:end]

		// Convert to []interface{} for JSON marshaling
		batchIface := make([]interface{}, len(batch))
		for i, id := range batch {
			batchIface[i] = id
		}

		gql := `
		query ($malIds: [Int]) {
			Page(perPage: 50) {
				media(idMal_in: $malIds, type: ANIME) {
					id
					idMal
					title { english }
					coverImage { large medium }
					bannerImage
					seasonYear
					status
					episodes
				}
			}
		}`

		payload := map[string]interface{}{
			"query":     gql,
			"variables": map[string]interface{}{"malIds": batchIface},
		}

		body, err := m.postJSON(anilistEndpoint, payload)
		if err != nil {
			fmt.Printf("[AniList Enrich] Batch request failed: %v\n", err)
			time.Sleep(1 * time.Second)
			continue
		}

		var resp struct {
			Data struct {
				Page struct {
					Media []struct {
						ID    int `json:"id"`
						IDMal int `json:"idMal"`
						Title struct {
							English string `json:"english"`
						} `json:"title"`
						CoverImage struct {
							Large  string `json:"large"`
							Medium string `json:"medium"`
						} `json:"coverImage"`
						BannerImage string `json:"bannerImage"`
						SeasonYear  int    `json:"seasonYear"`
						Status      string `json:"status"`
						Episodes    int    `json:"episodes"`
					} `json:"media"`
				} `json:"Page"`
			} `json:"data"`
		}

		if err := json.Unmarshal(body, &resp); err != nil {
			fmt.Printf("[AniList Enrich] Parse failed: %v\n", err)
			time.Sleep(1 * time.Second)
			continue
		}

		found := 0
		for _, media := range resp.Data.Page.Media {
			indices, ok := malIDToIndices[media.IDMal]
			if !ok {
				continue
			}

			cover := media.CoverImage.Large
			if cover == "" {
				cover = media.CoverImage.Medium
			}

			for _, idx := range indices {
				if cover != "" {
					entries[idx].ImageURL = cover
				}
				if media.BannerImage != "" {
					entries[idx].BannerImage = media.BannerImage
				}
				if media.Title.English != "" {
					entries[idx].TitleEnglish = media.Title.English
				}
				if media.SeasonYear > 0 {
					entries[idx].Year = media.SeasonYear
				}
				if media.Status != "" {
					entries[idx].AiringStatus = media.Status
				}
				if media.Episodes > 0 && entries[idx].EpisodesTotal == 0 {
					entries[idx].EpisodesTotal = media.Episodes
				}
				entries[idx].AnilistID = media.ID
			}
			found++
		}

		fmt.Printf("[AniList Enrich] Batch %d-%d: %d/%d covers found\n",
			start+1, end, found, len(batch))

		// Rate limit: AniList allows 90 req/min, be conservative
		time.Sleep(800 * time.Millisecond)
	}
	return entries
}

func mustAtoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
