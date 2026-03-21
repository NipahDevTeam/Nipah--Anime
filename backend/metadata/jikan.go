package metadata

import (
	"encoding/json"
	"fmt"
	"io"
	"time"
)

const jikanEndpoint = "https://api.jikan.moe/v4"

// JikanAnimeEntry represents a single anime entry from a MAL user's list.
type JikanAnimeEntry struct {
	MalID           int     `json:"mal_id"`
	Title           string  `json:"title"`
	TitleEnglish    string  `json:"title_english"`
	ImageURL        string  `json:"image_url"`
	BannerImage     string  `json:"banner_image"`
	Status          string  `json:"status"`
	EpisodesWatched int     `json:"episodes_watched"`
	EpisodesTotal   int     `json:"episodes_total"`
	Score           float64 `json:"score"`
	AiringStatus    string  `json:"airing_status"`
	Year            int     `json:"year"`
	AnilistID       int     `json:"anilist_id"`
}

// jikanUserListResponse is the raw JSON shape from Jikan /users/{username}/animelist
type jikanUserListResponse struct {
	Data       []jikanAnimeData `json:"data"`
	Pagination struct {
		LastVisiblePage int  `json:"last_visible_page"`
		HasNextPage     bool `json:"has_next_page"`
	} `json:"pagination"`
}

type jikanAnimeData struct {
	Entry struct {
		MalID  int    `json:"mal_id"`
		Title  string `json:"title"`
		Images struct {
			JPG struct {
				LargeImageURL string `json:"large_image_url"`
				ImageURL      string `json:"image_url"`
			} `json:"jpg"`
		} `json:"images"`
		Episodes int    `json:"episodes"`
		Year     int    `json:"year"`
		Status   string `json:"status"`
	} `json:"entry"`
	Score           int    `json:"score"`
	EpisodesWatched int    `json:"episodes_watched"`
	Status          string `json:"status"`
}

var malStatusToInternal = map[string]string{
	"Watching":      "WATCHING",
	"Completed":     "COMPLETED",
	"On-Hold":       "ON_HOLD",
	"Dropped":       "DROPPED",
	"Plan to Watch": "PLANNING",
}

// FetchMALUserAnimeList fetches the full anime list for a MAL user via Jikan API.
func (m *Manager) FetchMALUserAnimeList(username string) ([]JikanAnimeEntry, error) {
	var allEntries []JikanAnimeEntry
	page := 1

	for {
		url := fmt.Sprintf("%s/users/%s/animelist?page=%d", jikanEndpoint, username, page)
		entries, hasNext, err := m.fetchJikanPage(url)
		if err != nil {
			return allEntries, fmt.Errorf("page %d: %w", page, err)
		}
		allEntries = append(allEntries, entries...)

		if !hasNext {
			break
		}
		page++
		// Jikan rate limit: ~3 requests per second
		time.Sleep(400 * time.Millisecond)
	}

	return allEntries, nil
}

func (m *Manager) fetchJikanPage(url string) ([]JikanAnimeEntry, bool, error) {
	resp, err := m.client.Get(url)
	if err != nil {
		return nil, false, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return nil, false, fmt.Errorf("usuario no encontrado")
	}
	if resp.StatusCode == 429 {
		time.Sleep(2 * time.Second)
		return m.fetchJikanPage(url)
	}
	if resp.StatusCode != 200 {
		return nil, false, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, false, fmt.Errorf("read body: %w", err)
	}

	var result jikanUserListResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, false, fmt.Errorf("parse JSON: %w", err)
	}

	entries := make([]JikanAnimeEntry, 0, len(result.Data))
	for _, d := range result.Data {
		status := malStatusToInternal[d.Status]
		if status == "" {
			status = "PLANNING"
		}

		imageURL := d.Entry.Images.JPG.LargeImageURL
		if imageURL == "" {
			imageURL = d.Entry.Images.JPG.ImageURL
		}

		entries = append(entries, JikanAnimeEntry{
			MalID:           d.Entry.MalID,
			Title:           d.Entry.Title,
			ImageURL:        imageURL,
			Status:          status,
			EpisodesWatched: d.EpisodesWatched,
			EpisodesTotal:   d.Entry.Episodes,
			Score:           float64(d.Score),
			AiringStatus:    d.Entry.Status,
			Year:            d.Entry.Year,
		})
	}

	return entries, result.Pagination.HasNextPage, nil
}

// ResolveMALToAniList finds the AniList ID for a given MAL ID using AniList GraphQL.
func (m *Manager) ResolveMALToAniList(malID int) (int, string, error) {
	gql := `
	query ($malId: Int) {
		Media(idMal: $malId, type: ANIME) {
			id
			title { english }
		}
	}`

	vars := map[string]interface{}{"malId": malID}
	raw, err := m.postJSON(anilistEndpoint, map[string]interface{}{
		"query": gql, "variables": vars,
	})
	if err != nil {
		return 0, "", err
	}

	var parsed struct {
		Data struct {
			Media struct {
				ID    int `json:"id"`
				Title struct {
					English string `json:"english"`
				} `json:"title"`
			} `json:"Media"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return 0, "", err
	}
	if parsed.Data.Media.ID == 0 {
		return 0, "", fmt.Errorf("no AniList match for MAL ID %d", malID)
	}

	return parsed.Data.Media.ID, parsed.Data.Media.Title.English, nil
}
