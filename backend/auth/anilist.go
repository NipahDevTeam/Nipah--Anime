package auth

import (
	"encoding/json"
	"fmt"
	"io"
	clienthttp "miruro/backend/httpclient"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	anilistAuthURL  = "https://anilist.co/api/v2/oauth/authorize"
	anilistTokenURL = "https://anilist.co/api/v2/oauth/token"
	anilistGraphQL  = "https://graphql.anilist.co"
)

var aniListHTTPClient = clienthttp.NewStdClient(30 * time.Second)

// AniListTokenResponse is the response from the AniList token exchange.
type AniListTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"` // seconds (typically 604800 = 7 days)
}

// AniListUser holds basic user info from AniList.
type AniListUser struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

// AniListLoginURL builds the authorization URL and starts the callback server.
// Returns the URL to open in the browser and a channel that will receive the token.
func AniListLoginURL(redirectURI string) string {
	params := url.Values{}
	params.Set("client_id", AniListClientID)
	params.Set("redirect_uri", redirectURI)
	params.Set("response_type", "code")
	return fmt.Sprintf("%s?%s", anilistAuthURL, params.Encode())
}

// AniListExchangeCode exchanges an authorization code for an access token.
func AniListExchangeCode(code, redirectURI string) (*AniListTokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", AniListClientID)
	form.Set("client_secret", AniListClientSecret)
	form.Set("redirect_uri", redirectURI)
	form.Set("code", code)

	req, err := http.NewRequest("POST", anilistTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("token exchange failed: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Nipah-Anime/1.0")

	resp, err := aniListHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token exchange failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("token exchange HTTP %d for redirect %s: %s", resp.StatusCode, redirectURI, string(b))
	}

	var token AniListTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return nil, fmt.Errorf("token parse failed: %w", err)
	}
	if token.AccessToken == "" {
		return nil, fmt.Errorf("token exchange returned an empty access token")
	}
	return &token, nil
}

// AniListGetViewer fetches the authenticated user's profile.
func AniListGetViewer(accessToken string) (*AniListUser, error) {
	query := `{"query": "{ Viewer { id name avatar { large } } }"}`
	req, _ := http.NewRequest("POST", anilistGraphQL, strings.NewReader(query))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := aniListHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("AniList viewer HTTP %d: %s", resp.StatusCode, string(b))
	}

	var result struct {
		Data struct {
			Viewer struct {
				ID     int    `json:"id"`
				Name   string `json:"name"`
				Avatar struct {
					Large string `json:"large"`
				} `json:"avatar"`
			} `json:"Viewer"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
			Status  int    `json:"status"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("AniList viewer error: %s", result.Errors[0].Message)
	}
	v := result.Data.Viewer
	if v.ID == 0 || v.Name == "" {
		return nil, fmt.Errorf("AniList viewer response did not include a valid user")
	}
	return &AniListUser{ID: v.ID, Name: v.Name, Avatar: v.Avatar.Large}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// List Fetching
// ─────────────────────────────────────────────────────────────────────────────

// AniListListEntry represents a single anime or manga entry from the user's list.
type AniListListEntry struct {
	MediaID         int     `json:"media_id"`
	MalID           int     `json:"mal_id"`
	Status          string  `json:"status"` // CURRENT, COMPLETED, PLANNING, PAUSED, DROPPED, REPEATING
	Score           float64 `json:"score"`
	Progress        int     `json:"progress"`         // episodes watched or chapters read
	ProgressVolumes int     `json:"progress_volumes"` // volumes read (manga only)
	Title           string  `json:"title"`
	TitleEnglish    string  `json:"title_english"`
	CoverImage      string  `json:"cover_image"`
	BannerImage     string  `json:"banner_image"`
	TotalEpisodes   int     `json:"total_episodes"`
	TotalChapters   int     `json:"total_chapters"`
	TotalVolumes    int     `json:"total_volumes"`
	Year            int     `json:"year"`
	AiringStatus    string  `json:"airing_status"`
	MediaType       string  `json:"media_type"` // ANIME or MANGA
}

const anilistListQuery = `
query ($userId: Int, $type: MediaType) {
  MediaListCollection(userId: $userId, type: $type) {
    lists {
      entries {
        status
        score(format: POINT_10_DECIMAL)
        progress
        progressVolumes
        media {
          id
          idMal
          type
          title { romaji english }
          coverImage { extraLarge large }
          bannerImage
          episodes
          chapters
          volumes
          seasonYear
          startDate { year }
          status
        }
      }
    }
  }
}`

// AniListFetchLists fetches the user's anime or manga list from AniList.
func AniListFetchLists(accessToken string, userID int, mediaType string) ([]AniListListEntry, error) {
	variables := fmt.Sprintf(`{"userId": %d, "type": "%s"}`, userID, mediaType)
	body := fmt.Sprintf(`{"query": %s, "variables": %s}`,
		jsonStr(anilistListQuery), variables)

	req, _ := http.NewRequest("POST", anilistGraphQL, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := aniListHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("AniList list fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("AniList HTTP %d: %s", resp.StatusCode, string(b))
	}

	var result struct {
		Data struct {
			MediaListCollection struct {
				Lists []struct {
					Entries []struct {
						Status          string  `json:"status"`
						Score           float64 `json:"score"`
						Progress        int     `json:"progress"`
						ProgressVolumes int     `json:"progressVolumes"`
						Media           struct {
							ID    int    `json:"id"`
							IDMal int    `json:"idMal"`
							Type  string `json:"type"`
							Title struct {
								Romaji  string `json:"romaji"`
								English string `json:"english"`
							} `json:"title"`
							CoverImage struct {
								ExtraLarge string `json:"extraLarge"`
								Large      string `json:"large"`
							} `json:"coverImage"`
							BannerImage string `json:"bannerImage"`
							Episodes    int    `json:"episodes"`
							Chapters    int    `json:"chapters"`
							Volumes     int    `json:"volumes"`
							SeasonYear  int    `json:"seasonYear"`
							StartDate   struct {
								Year int `json:"year"`
							} `json:"startDate"`
							Status string `json:"status"`
						} `json:"media"`
					} `json:"entries"`
				} `json:"lists"`
			} `json:"MediaListCollection"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("AniList response parse failed: %w", err)
	}

	var entries []AniListListEntry
	for _, list := range result.Data.MediaListCollection.Lists {
		for _, e := range list.Entries {
			m := e.Media
			cover := m.CoverImage.ExtraLarge
			if cover == "" {
				cover = m.CoverImage.Large
			}
			year := m.SeasonYear
			if year == 0 {
				year = m.StartDate.Year
			}
			title := m.Title.Romaji
			titleEn := m.Title.English

			entries = append(entries, AniListListEntry{
				MediaID:         m.ID,
				MalID:           m.IDMal,
				Status:          e.Status,
				Score:           e.Score,
				Progress:        e.Progress,
				ProgressVolumes: e.ProgressVolumes,
				Title:           title,
				TitleEnglish:    titleEn,
				CoverImage:      cover,
				BannerImage:     m.BannerImage,
				TotalEpisodes:   m.Episodes,
				TotalChapters:   m.Chapters,
				TotalVolumes:    m.Volumes,
				Year:            year,
				AiringStatus:    m.Status,
				MediaType:       m.Type,
			})
		}
	}

	return entries, nil
}

// jsonStr escapes a string for embedding in a JSON value.
func jsonStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

type AniListUpsertInput struct {
	MediaID         int
	Status          string
	Progress        int
	ProgressVolumes int
	Score           float64
}

func AniListUpsertListEntry(accessToken string, input AniListUpsertInput) error {
	payload := map[string]interface{}{
		"query": `
mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $progressVolumes: Int, $score: Float) {
  SaveMediaListEntry(
    mediaId: $mediaId
    status: $status
    progress: $progress
    progressVolumes: $progressVolumes
    score: $score
  ) {
    id
  }
}`,
		"variables": map[string]interface{}{
			"mediaId":         input.MediaID,
			"status":          input.Status,
			"progress":        input.Progress,
			"progressVolumes": input.ProgressVolumes,
			"score":           input.Score,
		},
	}
	return aniListGraphQLCall(accessToken, payload)
}

func AniListDeleteListEntry(accessToken string, userID int, mediaID int) error {
	if mediaID <= 0 || userID <= 0 {
		return nil
	}

	var findResp struct {
		Data struct {
			MediaList *struct {
				ID int `json:"id"`
			} `json:"MediaList"`
		} `json:"data"`
	}
	findPayload := map[string]interface{}{
		"query": `
query ($mediaId: Int, $userId: Int) {
  MediaList(mediaId: $mediaId, userId: $userId) {
    id
  }
}`,
		"variables": map[string]interface{}{
			"mediaId": mediaID,
			"userId":  userID,
		},
	}
	if err := aniListGraphQLCallInto(accessToken, findPayload, &findResp); err != nil {
		return err
	}
	if findResp.Data.MediaList == nil || findResp.Data.MediaList.ID <= 0 {
		return nil
	}

	deletePayload := map[string]interface{}{
		"query": `
mutation ($id: Int) {
  DeleteMediaListEntry(id: $id) {
    deleted
  }
}`,
		"variables": map[string]interface{}{
			"id": findResp.Data.MediaList.ID,
		},
	}
	return aniListGraphQLCall(accessToken, deletePayload)
}

func aniListGraphQLCall(accessToken string, payload map[string]interface{}) error {
	return aniListGraphQLCallInto(accessToken, payload, nil)
}

func aniListGraphQLCallInto(accessToken string, payload map[string]interface{}, dest interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("AniList payload encode failed: %w", err)
	}

	req, err := http.NewRequest("POST", anilistGraphQL, strings.NewReader(string(body)))
	if err != nil {
		return fmt.Errorf("AniList request failed: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Nipah-Anime/1.0")

	resp, err := aniListHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("AniList request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("AniList response read failed: %w", err)
	}
	if resp.StatusCode != 200 {
		return fmt.Errorf("AniList HTTP %d: %s", resp.StatusCode, string(raw))
	}

	var errResp struct {
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	_ = json.Unmarshal(raw, &errResp)
	if len(errResp.Errors) > 0 {
		return fmt.Errorf("AniList error: %s", errResp.Errors[0].Message)
	}
	if dest != nil {
		if err := json.Unmarshal(raw, dest); err != nil {
			return fmt.Errorf("AniList response parse failed: %w", err)
		}
	}
	return nil
}
