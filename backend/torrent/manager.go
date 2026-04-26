// Package torrent handles anime torrent search via AnimeTosho and Nyaa.
package torrent

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type TorrentResult struct {
	Title    string `json:"title"`
	Magnet   string `json:"magnet"`
	Size     string `json:"size"`
	Seeders  int    `json:"seeders"`
	Leechers int    `json:"leechers"`
	IsBatch  bool   `json:"is_batch"`
	Quality  string `json:"quality"`
	Group    string `json:"group"`
	Source   string `json:"source"`
	InfoHash string `json:"info_hash"`
}

// ── AnimeTosho ────────────────────────────────────────────────────────────────

type toshoEntry struct {
	Title     string `json:"title"`
	MagnetURI string `json:"magnet_uri"`
	TotalSize int64  `json:"total_size"`
	Seeders   int    `json:"seeders"`
	Leechers  int    `json:"leechers"`
	InfoHash  string `json:"info_hash"`
}

func SearchAnimeTosho(query string, anilistID int) ([]TorrentResult, error) {
	var apiURL string
	if anilistID > 0 {
		apiURL = fmt.Sprintf("https://feed.animetosho.org/json?anilist_id=%d", anilistID)
	} else {
		apiURL = fmt.Sprintf("https://feed.animetosho.org/json?q=%s", url.QueryEscape(query))
	}
	body, err := httpGet(apiURL)
	if err != nil {
		return nil, fmt.Errorf("animetosho: %w", err)
	}
	var entries []toshoEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		return nil, fmt.Errorf("animetosho parse: %w", err)
	}
	var out []TorrentResult
	for _, e := range entries {
		if e.MagnetURI == "" {
			continue
		}
		out = append(out, TorrentResult{
			Title:    e.Title,
			Magnet:   e.MagnetURI,
			Size:     formatSize(e.TotalSize),
			Seeders:  e.Seeders,
			Leechers: e.Leechers,
			IsBatch:  isBatch(e.Title),
			Quality:  detectQuality(e.Title),
			Group:    extractGroup(e.Title),
			Source:   "animetosho",
			InfoHash: e.InfoHash,
		})
	}
	return sortResults(out, query), nil
}

// ── Nyaa ──────────────────────────────────────────────────────────────────────

type nyaaRSS struct {
	XMLName xml.Name   `xml:"rss"`
	Items   []nyaaItem `xml:"channel>item"`
}

type nyaaItem struct {
	Title    string `xml:"title"`
	Seeders  int    `xml:"seeders"`
	Leechers int    `xml:"leechers"`
	InfoHash string `xml:"infoHash"`
	Size     string `xml:"size"`
	Magnet   string `xml:"magnet"`
}

func SearchNyaa(query string) ([]TorrentResult, error) {
	var out []TorrentResult
	seen := map[string]struct{}{}
	for _, cat := range []string{"1_2", "1_4"} {
		apiURL := fmt.Sprintf("https://nyaa.si/?page=rss&q=%s&c=%s&f=0",
			url.QueryEscape(query), cat)
		body, err := httpGet(apiURL)
		if err != nil {
			continue
		}
		var feed nyaaRSS
		if err := xml.Unmarshal(body, &feed); err != nil {
			continue
		}
		for _, item := range feed.Items {
			magnet := item.Magnet
			if magnet == "" && item.InfoHash != "" {
				magnet = fmt.Sprintf("magnet:?xt=urn:btih:%s&dn=%s",
					item.InfoHash, url.QueryEscape(item.Title))
			}
			if magnet == "" {
				continue
			}
			key := strings.TrimSpace(item.InfoHash)
			if key == "" {
				key = strings.TrimSpace(magnet)
			}
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, TorrentResult{
				Title:    item.Title,
				Magnet:   magnet,
				Size:     item.Size,
				Seeders:  item.Seeders,
				Leechers: item.Leechers,
				IsBatch:  isBatch(item.Title),
				Quality:  detectQuality(item.Title),
				Group:    extractGroup(item.Title),
				Source:   "nyaa",
				InfoHash: item.InfoHash,
			})
		}
	}
	return sortResults(out, query), nil
}

// ── Torrent client ────────────────────────────────────────────────────────────

func OpenMagnet(magnet, clientPath, downloadPath string) error {
	if clientPath == "" {
		return openSystemURL(magnet)
	}
	args := []string{magnet}
	if downloadPath != "" && strings.Contains(strings.ToLower(clientPath), "qbit") {
		args = append(args, fmt.Sprintf("--save-path=%s", downloadPath))
	}
	return exec.Command(clientPath, args...).Start()
}

func openSystemURL(u string) error {
	var cmd *exec.Cmd
	if os.PathSeparator == '\\' {
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	} else {
		cmd = exec.Command("xdg-open", u)
	}
	return cmd.Start()
}

func DefaultDownloadPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(home, "Videos", "Nipah!", "Anime")
	if err := os.MkdirAll(path, 0755); err != nil {
		return "", err
	}
	return path, nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// knownSpanishGroups only includes groups/tags confirmed to produce Spanish content.
var knownSpanishGroups = []string{
	"donatello", "shiro", "subsplease-es", "subses", "animeblue",
	"fenix-fansub", "nkid", "animeid", "animelatino",
	"español", "castellano", "latino", "latam", "sub español", "sub-español",
	"multi-lang", "multilang", "multi lang",
}

// knownPTGroups includes tags confirmed to indicate Portuguese/PT-BR content.
var knownPTGroups = []string{
	// Language tags
	"pt-br", "dublado", "legendado", "português", "portugues",
	"dub pt", "sub pt", "audio pt", "ptbr",
	// Known PT-BR fansub groups on Nyaa
	"akatsuki", "yuri-fansub", "livra", "blaze", "subs pt",
}

func isPTGroup(title string) bool {
	t := strings.ToLower(title)
	for _, g := range knownPTGroups {
		if strings.Contains(t, g) {
			return true
		}
	}
	return false
}

func isSpanishGroup(title string) bool {
	t := strings.ToLower(title)
	for _, g := range knownSpanishGroups {
		if strings.Contains(t, g) {
			return true
		}
	}
	return false
}

// sortResults prefers accurate English-subbed releases and stronger swarm health.
func sortResults(results []TorrentResult, query string) []TorrentResult {
	sort.SliceStable(results, func(i, j int) bool {
		leftScore, leftSeeders := rankResult(results[i], query)
		rightScore, rightSeeders := rankResult(results[j], query)
		if leftScore == rightScore {
			if leftSeeders == rightSeeders {
				return strings.ToLower(results[i].Title) < strings.ToLower(results[j].Title)
			}
			return leftSeeders > rightSeeders
		}
		return leftScore > rightScore
	})
	return results
}

func rankResult(result TorrentResult, query string) (int, int) {
	title := strings.ToLower(strings.TrimSpace(result.Title))
	queryNorm := normalizeTorrentText(query)
	titleNorm := normalizeTorrentText(title)
	score := result.Seeders * 4

	if queryNorm != "" && titleNorm == queryNorm {
		score += 500
	}
	if queryNorm != "" && strings.Contains(titleNorm, queryNorm) {
		score += 260
	}
	score += tokenOverlapScore(queryNorm, titleNorm)

	if prefersEnglishSubs(title) {
		score += 220
	}
	if indicatesRaw(title) {
		score -= 320
	}
	if isSpanishGroup(title) || isPTGroup(title) {
		score -= 240
	}
	if indicatesDub(title) {
		score -= 140
	}
	if result.IsBatch {
		score += 35
	}

	switch strings.ToUpper(result.Quality) {
	case "1080P":
		score += 60
	case "720P":
		score += 25
	case "4K":
		score += 12
	case "480P":
		score -= 10
	}

	if ep := extractEpisodeHint(queryNorm); ep > 0 {
		if strings.Contains(titleNorm, fmt.Sprintf(" %02d ", ep)) || strings.Contains(titleNorm, fmt.Sprintf(" %d ", ep)) {
			score += 110
		}
	}

	return score, result.Seeders
}

func normalizeTorrentText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}

	var b strings.Builder
	b.Grow(len(value))
	lastSpace := true
	for _, r := range value {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			lastSpace = false
		default:
			if !lastSpace {
				b.WriteByte(' ')
				lastSpace = true
			}
		}
	}
	return strings.TrimSpace(b.String())
}

func tokenOverlapScore(queryNorm, titleNorm string) int {
	if queryNorm == "" || titleNorm == "" {
		return 0
	}
	titleTokens := map[string]struct{}{}
	for _, token := range strings.Fields(titleNorm) {
		titleTokens[token] = struct{}{}
	}

	score := 0
	for _, token := range strings.Fields(queryNorm) {
		if len(token) <= 1 {
			continue
		}
		if _, ok := titleTokens[token]; ok {
			score += 32
		}
	}
	return score
}

func prefersEnglishSubs(title string) bool {
	for _, marker := range []string{
		" english", " eng sub", " engsubs", " subsplease", " erai", " sub ", " softsub", " multi sub",
	} {
		if strings.Contains(title, marker) {
			return true
		}
	}
	return false
}

func indicatesRaw(title string) bool {
	for _, marker := range []string{" raw", "[raw]", " no subs", " unsubbed"} {
		if strings.Contains(title, marker) {
			return true
		}
	}
	return false
}

func indicatesDub(title string) bool {
	for _, marker := range []string{" dub", "dual audio", "multi audio", "eng dub"} {
		if strings.Contains(title, marker) {
			return true
		}
	}
	return false
}

func extractEpisodeHint(queryNorm string) int {
	tokens := strings.Fields(queryNorm)
	for i := len(tokens) - 1; i >= 0; i-- {
		token := tokens[i]
		if n, err := strconv.Atoi(token); err == nil && n > 0 && n < 5000 {
			return n
		}
	}
	return 0
}

func isBatch(title string) bool {
	t := strings.ToLower(title)
	for _, kw := range []string{"batch", "complete", "bd ", "blu-ray", "bluray", "pack"} {
		if strings.Contains(t, kw) {
			return true
		}
	}
	return false
}

func detectQuality(title string) string {
	t := strings.ToLower(title)
	switch {
	case strings.Contains(t, "2160p") || strings.Contains(t, "4k"):
		return "4K"
	case strings.Contains(t, "1080p"):
		return "1080p"
	case strings.Contains(t, "720p"):
		return "720p"
	case strings.Contains(t, "480p"):
		return "480p"
	case strings.Contains(t, "bd") || strings.Contains(t, "blu-ray"):
		return "BD"
	default:
		return ""
	}
}

func extractGroup(title string) string {
	if strings.HasPrefix(title, "[") {
		if end := strings.Index(title, "]"); end > 1 {
			return title[1:end]
		}
	}
	return ""
}

func formatSize(b int64) string {
	switch {
	case b >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(b)/(1<<30))
	case b >= 1<<20:
		return fmt.Sprintf("%.0f MB", float64(b)/(1<<20))
	default:
		return fmt.Sprintf("%d KB", b>>10)
	}
}

func httpGet(rawURL string) ([]byte, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, _ := http.NewRequest("GET", rawURL, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}
