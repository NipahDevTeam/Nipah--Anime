package auth

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	malAuthURL  = "https://myanimelist.net/v1/oauth2/authorize"
	malTokenURL = "https://myanimelist.net/v1/oauth2/token"
	malAPIBase  = "https://api.myanimelist.net/v2"
)

// MALTokenResponse is the response from the MAL token exchange.
type MALTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"` // seconds (typically 3600 = 1 hour)
}

// MALUser holds basic user info from MAL.
type MALUser struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

// MALLoginURL builds the authorization URL with PKCE.
// Returns the URL and the code_verifier (needed for token exchange).
func MALLoginURL(redirectURI string) (authURL, codeVerifier string) {
	// PKCE: MAL accepts plain code_challenge_method
	codeVerifier = RandomString(64) // 128 hex chars
	state := RandomString(16)

	params := url.Values{}
	params.Set("client_id", MALClientID)
	params.Set("response_type", "code")
	params.Set("state", state)
	params.Set("redirect_uri", redirectURI)
	params.Set("code_challenge", codeVerifier)
	params.Set("code_challenge_method", "plain")

	authURL = fmt.Sprintf("%s?%s", malAuthURL, params.Encode())
	return authURL, codeVerifier
}

// MALExchangeCode exchanges an authorization code for tokens using PKCE.
func MALExchangeCode(code, codeVerifier, redirectURI string) (*MALTokenResponse, error) {
	data := url.Values{
		"client_id":     {MALClientID},
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {codeVerifier},
		"redirect_uri":  {redirectURI},
	}

	resp, err := http.PostForm(malTokenURL, data)
	if err != nil {
		return nil, fmt.Errorf("MAL token exchange failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("MAL token exchange HTTP %d: %s", resp.StatusCode, string(b))
	}

	var token MALTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return nil, fmt.Errorf("MAL token parse failed: %w", err)
	}
	return &token, nil
}

// MALRefreshToken refreshes an expired MAL access token.
func MALRefreshToken(refreshToken string) (*MALTokenResponse, error) {
	data := url.Values{
		"client_id":     {MALClientID},
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	}

	resp, err := http.PostForm(malTokenURL, data)
	if err != nil {
		return nil, fmt.Errorf("MAL token refresh failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("MAL token refresh HTTP %d: %s", resp.StatusCode, string(b))
	}

	var token MALTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return nil, fmt.Errorf("MAL token refresh parse failed: %w", err)
	}
	return &token, nil
}

// MALGetUser fetches the authenticated user's profile.
func MALGetUser(accessToken string) (*MALUser, error) {
	req, _ := http.NewRequest("GET", malAPIBase+"/users/@me?fields=id,name,picture", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("MAL user fetch HTTP %d: %s", resp.StatusCode, string(b))
	}

	var user MALUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}
	return &user, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// List Fetching
// ─────────────────────────────────────────────────────────────────────────────

// MALListEntry represents a single anime or manga from the MAL user's list.
type MALListEntry struct {
	ID              int    `json:"id"`
	Title           string `json:"title"`
	Picture         string `json:"picture"`
	Status          string `json:"status"` // watching, completed, on_hold, dropped, plan_to_watch
	Score           int    `json:"score"`
	EpisodesWatched int    `json:"episodes_watched"`
	EpisodesTotal   int    `json:"episodes_total"`
	ChaptersRead    int    `json:"chapters_read"`
	ChaptersTotal   int    `json:"chapters_total"`
	VolumesRead     int    `json:"volumes_read"`
	VolumesTotal    int    `json:"volumes_total"`
	MediaType       string `json:"media_type"` // "anime" or "manga"
	StartYear       int    `json:"start_year"`
}

// MALFetchAnimeList fetches the user's full anime list from MAL API v2.
func MALFetchAnimeList(accessToken string) ([]MALListEntry, error) {
	return malFetchList(accessToken, "/users/@me/animelist", "anime",
		"list_status{status,score,num_episodes_watched},num_episodes,main_picture,start_date,media_type")
}

// MALFetchMangaList fetches the user's full manga list from MAL API v2.
func MALFetchMangaList(accessToken string) ([]MALListEntry, error) {
	return malFetchList(accessToken, "/users/@me/mangalist", "manga",
		"list_status{status,score,num_chapters_read,num_volumes_read},num_chapters,num_volumes,main_picture,start_date,media_type")
}

func malFetchList(accessToken, path, listType, fields string) ([]MALListEntry, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	var all []MALListEntry

	nextURL := fmt.Sprintf("%s%s?fields=%s&limit=1000&nsfw=true", malAPIBase, path, fields)

	for nextURL != "" {
		req, _ := http.NewRequest("GET", nextURL, nil)
		req.Header.Set("Authorization", "Bearer "+accessToken)

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("MAL list fetch failed: %w", err)
		}

		if resp.StatusCode != 200 {
			b, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return nil, fmt.Errorf("MAL list HTTP %d: %s", resp.StatusCode, string(b))
		}

		var page struct {
			Data []struct {
				Node struct {
					ID          int    `json:"id"`
					Title       string `json:"title"`
					MainPicture struct {
						Large  string `json:"large"`
						Medium string `json:"medium"`
					} `json:"main_picture"`
					NumEpisodes int    `json:"num_episodes"`
					NumChapters int    `json:"num_chapters"`
					NumVolumes  int    `json:"num_volumes"`
					StartDate   string `json:"start_date"`
					MediaType   string `json:"media_type"`
				} `json:"node"`
				ListStatus struct {
					Status             string `json:"status"`
					Score              int    `json:"score"`
					NumEpisodesWatched int    `json:"num_episodes_watched"`
					NumChaptersRead    int    `json:"num_chapters_read"`
					NumVolumesRead     int    `json:"num_volumes_read"`
				} `json:"list_status"`
			} `json:"data"`
			Paging struct {
				Next string `json:"next"`
			} `json:"paging"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
			resp.Body.Close()
			return nil, fmt.Errorf("MAL list parse failed: %w", err)
		}
		resp.Body.Close()

		for _, item := range page.Data {
			n := item.Node
			ls := item.ListStatus
			pic := n.MainPicture.Large
			if pic == "" {
				pic = n.MainPicture.Medium
			}

			year := 0
			if len(n.StartDate) >= 4 {
				if _, err := fmt.Sscanf(n.StartDate[:4], "%d", &year); err != nil {
					year = 0
				}
			}

			entry := MALListEntry{
				ID:              n.ID,
				Title:           n.Title,
				Picture:         pic,
				Status:          ls.Status,
				Score:           ls.Score,
				EpisodesWatched: ls.NumEpisodesWatched,
				EpisodesTotal:   n.NumEpisodes,
				ChaptersRead:    ls.NumChaptersRead,
				ChaptersTotal:   n.NumChapters,
				VolumesRead:     ls.NumVolumesRead,
				VolumesTotal:    n.NumVolumes,
				MediaType:       listType,
				StartYear:       year,
			}
			all = append(all, entry)
		}

		nextURL = page.Paging.Next

		// Rate limit: ~1 req/sec for MAL
		if nextURL != "" {
			time.Sleep(500 * time.Millisecond)
		}
	}

	return all, nil
}

// MALStatusToInternal converts MAL status strings to our internal format.
func MALStatusToInternal(malStatus string) string {
	switch strings.ToLower(malStatus) {
	case "watching", "reading":
		return "WATCHING"
	case "completed":
		return "COMPLETED"
	case "on_hold":
		return "ON_HOLD"
	case "dropped":
		return "DROPPED"
	case "plan_to_watch", "plan_to_read":
		return "PLANNING"
	default:
		return "PLANNING"
	}
}

type MALUpsertInput struct {
	MediaType   string
	MediaID     int
	Status      string
	Score       float64
	Progress    int
	VolumesRead int
}

func MALUpsertListEntry(accessToken string, input MALUpsertInput) error {
	if input.MediaID <= 0 {
		return nil
	}

	form := url.Values{}
	if status := strings.TrimSpace(strings.ToLower(input.Status)); status != "" {
		form.Set("status", status)
	}
	if input.Score > 0 {
		form.Set("score", strconv.Itoa(int(input.Score)))
	}
	switch strings.ToLower(input.MediaType) {
	case "manga":
		if input.Progress > 0 {
			form.Set("num_chapters_read", strconv.Itoa(input.Progress))
		}
		if input.VolumesRead > 0 {
			form.Set("num_volumes_read", strconv.Itoa(input.VolumesRead))
		}
	default:
		if input.Progress > 0 {
			form.Set("num_watched_episodes", strconv.Itoa(input.Progress))
		}
	}

	path := "anime"
	if strings.EqualFold(input.MediaType, "manga") {
		path = "manga"
	}
	req, err := http.NewRequest("PUT", fmt.Sprintf("%s/%s/%d/my_list_status", malAPIBase, path, input.MediaID), strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("MAL update request failed: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if MALClientID != "" {
		req.Header.Set("X-MAL-CLIENT-ID", MALClientID)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("MAL update failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("MAL HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func MALDeleteListEntry(accessToken, mediaType string, mediaID int) error {
	if mediaID <= 0 {
		return nil
	}
	path := "anime"
	if strings.EqualFold(mediaType, "manga") {
		path = "manga"
	}
	req, err := http.NewRequest("DELETE", fmt.Sprintf("%s/%s/%d/my_list_status", malAPIBase, path, mediaID), nil)
	if err != nil {
		return fmt.Errorf("MAL delete request failed: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	if MALClientID != "" {
		req.Header.Set("X-MAL-CLIENT-ID", MALClientID)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("MAL delete failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("MAL HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
