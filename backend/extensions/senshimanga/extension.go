package senshimanga

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"miruro/backend/extensions"
	"miruro/backend/extensions/sourceaccess"
)

const (
	sourceID = "senshimanga-es"
	baseURL  = "https://capibaratraductor.com"
	orgSlug  = "senshimanga"
)

var detailPropsRe = regexp.MustCompile(`(?s)component-url="[^"]*MangaDetailPageContainer[^"]*"[^>]*props="([^"]+)"`)

type Extension struct{}

type searchResponse struct {
	Status  bool   `json:"status"`
	Message string `json:"message"`
	Error   string `json:"error"`
	Data    struct {
		Items []searchItem `json:"items"`
	} `json:"data"`
}

type searchItem struct {
	Title            string `json:"title"`
	ShortDescription string `json:"shortDescription"`
	Description      string `json:"description"`
	ImageURL         string `json:"imageUrl"`
	IsNSFW           bool   `json:"isNSFW"`
	Manga            struct {
		Slug string `json:"slug"`
	} `json:"manga"`
}

type pagesResponse struct {
	Status  bool       `json:"status"`
	Message string     `json:"message"`
	Error   string     `json:"error"`
	Data    []pageItem `json:"data"`
}

type pageItem struct {
	Number   int    `json:"number"`
	ImageURL string `json:"imageUrl"`
}

func init() {
	sourceaccess.RegisterProfile(sourceaccess.SourceAccessProfile{
		SourceID:             sourceID,
		BaseURL:              baseURL,
		WarmupURL:            baseURL + "/" + orgSlug + "/search",
		DefaultReferer:       baseURL + "/" + orgSlug + "/",
		CookieDomains:        []string{"capibaratraductor.com", "r2.capibaratraductor.com"},
		ChallengeStatusCodes: []int{403},
		ChallengeBodyMarkers: []string{
			"just a moment",
			"enable javascript and cookies to continue",
			"cf-mitigated",
		},
		ChallengeHeaderMarkers: map[string]string{
			"Cf-Mitigated": "challenge",
		},
	})
}

func New() *Extension { return &Extension{} }

func (e *Extension) ID() string   { return sourceID }
func (e *Extension) Name() string { return "SenshiManga" }
func (e *Extension) Languages() []extensions.Language {
	return []extensions.Language{extensions.LangSpanish}
}

func (e *Extension) Search(query string, lang extensions.Language) ([]extensions.SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []extensions.SearchResult{}, nil
	}

	endpoint := fmt.Sprintf("%s/api/manga-custom?page=1&limit=48&order=latest&title=%s", baseURL, url.QueryEscape(query))
	body, err := sourceaccess.FetchJSON(e.ID(), endpoint, apiRequestOptions())
	if err != nil {
		return nil, fmt.Errorf("senshimanga search: %w", err)
	}

	var payload searchResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("senshimanga search parse: %w", err)
	}
	if !payload.Status {
		return nil, fmt.Errorf("senshimanga search failed: %s", firstNonEmpty(payload.Message, payload.Error, "unknown error"))
	}

	type scoredResult struct {
		result extensions.SearchResult
		score  int
	}

	queryNorm := normalizeSearch(query)
	seen := map[string]bool{}
	scored := make([]scoredResult, 0, len(payload.Data.Items))
	for _, item := range payload.Data.Items {
		slug := strings.TrimSpace(item.Manga.Slug)
		if slug == "" || seen[slug] {
			continue
		}
		seen[slug] = true

		title := cleanText(item.Title)
		if title == "" {
			continue
		}

		result := extensions.SearchResult{
			ID:          slug,
			Title:       title,
			CoverURL:    strings.TrimSpace(item.ImageURL),
			Description: cleanText(firstNonEmpty(item.ShortDescription, item.Description)),
			Languages:   []extensions.Language{extensions.LangSpanish},
		}
		scored = append(scored, scoredResult{
			result: result,
			score:  scoreSearch(queryNorm, title, slug),
		})
	}

	sort.Slice(scored, func(i, j int) bool {
		if scored[i].score == scored[j].score {
			return scored[i].result.Title < scored[j].result.Title
		}
		return scored[i].score > scored[j].score
	})

	results := make([]extensions.SearchResult, 0, len(scored))
	for _, item := range scored {
		results = append(results, item.result)
	}
	return results, nil
}

func (e *Extension) GetChapters(mangaID string, lang extensions.Language) ([]extensions.Chapter, error) {
	slug := normalizeSlug(mangaID)
	if slug == "" {
		return nil, fmt.Errorf("senshimanga: invalid manga id")
	}

	body, err := sourceaccess.FetchHTML(e.ID(), detailURL(slug), sourceaccess.RequestOptions{})
	if err != nil {
		return nil, fmt.Errorf("senshimanga chapters: %w", err)
	}

	props, err := extractDetailProps(body)
	if err != nil {
		return nil, err
	}

	payload := primaryMangaPayload(props)
	if payload == nil {
		return nil, fmt.Errorf("senshimanga: manga payload not found")
	}

	items := asSlice(payload["chapters"])
	if len(items) == 0 {
		return nil, fmt.Errorf("senshimanga: no chapters found")
	}

	chapters := make([]extensions.Chapter, 0, len(items))
	seen := map[string]bool{}
	for _, raw := range items {
		item := asMap(raw)
		if item == nil {
			continue
		}

		numberValue := item["number"]
		chapterToken := formatNumberToken(numberValue)
		if chapterToken == "" || seen[chapterToken] {
			continue
		}
		seen[chapterToken] = true

		title := cleanText(stringValue(item["title"]))
		if title == "" {
			title = fmt.Sprintf("Capitulo %s", chapterToken)
		}

		uploadedAt := firstNonEmpty(stringValue(item["releasedAt"]), stringValue(item["createdAt"]))
		locked := boolValue(item["isUnreleased"])
		if !locked {
			if releaseTime, err := time.Parse(time.RFC3339, stringValue(item["releasedAt"])); err == nil && releaseTime.After(time.Now().UTC()) {
				locked = true
			}
		}

		chapters = append(chapters, extensions.Chapter{
			ID:         slug + "/" + chapterToken,
			Number:     floatValue(numberValue),
			Title:      title,
			Language:   extensions.LangSpanish,
			UploadedAt: uploadedAt,
			Locked:     locked,
		})
	}

	sort.Slice(chapters, func(i, j int) bool {
		if chapters[i].Number == chapters[j].Number {
			return chapters[i].UploadedAt < chapters[j].UploadedAt
		}
		return chapters[i].Number < chapters[j].Number
	})

	return chapters, nil
}

func (e *Extension) GetPages(chapterID string) ([]extensions.PageSource, error) {
	slug, chapterToken, err := splitChapterID(chapterID)
	if err != nil {
		return nil, err
	}

	endpoint := fmt.Sprintf("%s/api/manga-custom/%s/chapter/%s/pages", baseURL, url.PathEscape(slug), url.PathEscape(chapterToken))
	body, err := sourceaccess.FetchJSON(e.ID(), endpoint, apiRequestOptions())
	if err != nil {
		return nil, fmt.Errorf("senshimanga pages: %w", err)
	}

	var payload pagesResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("senshimanga pages parse: %w", err)
	}
	if !payload.Status {
		return nil, fmt.Errorf("senshimanga pages failed: %s", firstNonEmpty(payload.Message, payload.Error, "unknown error"))
	}
	if len(payload.Data) == 0 {
		return nil, fmt.Errorf("senshimanga: no page images found")
	}

	sort.Slice(payload.Data, func(i, j int) bool { return payload.Data[i].Number < payload.Data[j].Number })

	chapterURL := chapterPageURL(slug, chapterToken)
	pages := make([]extensions.PageSource, 0, len(payload.Data))
	for index, item := range payload.Data {
		imageURL := strings.TrimSpace(item.ImageURL)
		if imageURL == "" {
			continue
		}
		pages = append(pages, extensions.PageSource{
			URL:   sourceaccess.BuildImageProxyURL(e.ID(), imageURL, chapterURL),
			Index: index,
		})
	}
	if len(pages) == 0 {
		return nil, fmt.Errorf("senshimanga: no valid page images found")
	}
	return pages, nil
}

func apiRequestOptions() sourceaccess.RequestOptions {
	return sourceaccess.RequestOptions{
		Headers: map[string]string{
			"Accept":         "application/json, text/plain, */*",
			"x-organization": orgSlug,
		},
	}
}

func detailURL(slug string) string {
	return fmt.Sprintf("%s/%s/manga/%s", baseURL, orgSlug, slug)
}

func chapterPageURL(slug, chapterToken string) string {
	return fmt.Sprintf("%s/%s/manga/%s/chapters/%s", baseURL, orgSlug, slug, chapterToken)
}

func extractDetailProps(body string) (map[string]any, error) {
	match := detailPropsRe.FindStringSubmatch(body)
	if len(match) < 2 {
		return nil, fmt.Errorf("senshimanga: detail payload not found")
	}

	raw := html.UnescapeString(match[1])
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.UseNumber()

	var payload any
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("senshimanga: detail payload decode failed: %w", err)
	}

	props, ok := astroDecodeValue(payload).(map[string]any)
	if !ok {
		return nil, fmt.Errorf("senshimanga: malformed detail payload")
	}
	return props, nil
}

func primaryMangaPayload(props map[string]any) map[string]any {
	if props == nil {
		return nil
	}

	if root := asMap(props["manga"]); root != nil {
		if len(asSlice(root["chapters"])) > 0 {
			return root
		}
	}
	if len(asSlice(props["chapters"])) > 0 {
		return props
	}
	return nil
}

func astroDecodeValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			out[key] = astroDecodeValue(item)
		}
		return out
	case []any:
		if len(typed) == 2 {
			if marker, ok := astroMarker(typed[0]); ok {
				switch marker {
				case 0:
					return astroDecodeValue(typed[1])
				case 1:
					items := asSlice(typed[1])
					out := make([]any, 0, len(items))
					for _, item := range items {
						out = append(out, astroDecodeValue(item))
					}
					return out
				default:
					return astroDecodeValue(typed[1])
				}
			}
		}

		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, astroDecodeValue(item))
		}
		return out
	default:
		return value
	}
}

func astroMarker(value any) (int, bool) {
	switch typed := value.(type) {
	case json.Number:
		num, err := typed.Int64()
		return int(num), err == nil
	case float64:
		return int(typed), true
	case int:
		return typed, true
	default:
		return 0, false
	}
}

func asMap(value any) map[string]any {
	typed, _ := value.(map[string]any)
	return typed
}

func asSlice(value any) []any {
	typed, _ := value.([]any)
	return typed
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func floatValue(value any) float64 {
	switch typed := value.(type) {
	case json.Number:
		number, _ := typed.Float64()
		return number
	case float64:
		return typed
	case string:
		number, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return number
	default:
		return 0
	}
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true")
	default:
		return false
	}
}

func formatNumberToken(value any) string {
	switch typed := value.(type) {
	case json.Number:
		return strings.TrimSpace(typed.String())
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case string:
		return strings.TrimSpace(typed)
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func splitChapterID(chapterID string) (string, string, error) {
	chapterID = strings.TrimSpace(strings.Trim(chapterID, "/"))
	if chapterID == "" {
		return "", "", fmt.Errorf("senshimanga: invalid chapter id")
	}

	parts := strings.SplitN(chapterID, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("senshimanga: malformed chapter id")
	}
	return parts[0], parts[1], nil
}

func normalizeSlug(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, baseURL+"/"+orgSlug+"/manga/")
	raw = strings.TrimPrefix(raw, "/"+orgSlug+"/manga/")
	raw = strings.TrimPrefix(raw, "/manga/")
	raw = strings.Trim(raw, "/")
	if idx := strings.Index(raw, "/"); idx >= 0 {
		raw = raw[:idx]
	}
	return raw
}

func cleanText(raw string) string {
	raw = html.UnescapeString(raw)
	raw = strings.ReplaceAll(raw, "\\u0026", "&")
	raw = strings.ReplaceAll(raw, "\\/", "/")
	raw = strings.TrimSpace(raw)
	return strings.Join(strings.Fields(raw), " ")
}

func normalizeSearch(raw string) string {
	replacer := strings.NewReplacer(
		"-", " ",
		"_", " ",
		".", " ",
		":", " ",
		"'", "",
		"\"", "",
	)
	raw = replacer.Replace(strings.ToLower(cleanText(raw)))
	return strings.Join(strings.Fields(raw), " ")
}

func scoreSearch(queryNorm, title, slug string) int {
	titleNorm := normalizeSearch(title)
	slugNorm := normalizeSearch(slug)

	score := 0
	switch {
	case titleNorm == queryNorm:
		score = 500
	case slugNorm == queryNorm:
		score = 470
	case strings.HasPrefix(titleNorm, queryNorm):
		score = 420
	case strings.HasPrefix(slugNorm, queryNorm):
		score = 390
	case strings.Contains(titleNorm, queryNorm):
		score = 320
	case strings.Contains(slugNorm, queryNorm):
		score = 290
	default:
		score = 0
	}

	return score - absInt(len(titleNorm)-len(queryNorm))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
