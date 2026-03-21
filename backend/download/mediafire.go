package download

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ResolveMediafire fetches a Mediafire sharing page and extracts the direct download URL.
// Mediafire pages have a download button with the direct link in an href or id="downloadButton".
func ResolveMediafire(shareURL string) (directURL string, fileName string, err error) {
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return nil // follow redirects
		},
	}

	req, err := http.NewRequest("GET", shareURL, nil)
	if err != nil {
		return "", "", fmt.Errorf("mediafire: bad URL: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("mediafire: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", "", fmt.Errorf("mediafire: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("mediafire: read body failed: %w", err)
	}
	html := string(body)

	// Strategy 1: Look for id="downloadButton" with href
	// Pattern: <a ... id="downloadButton" ... href="https://download...mediafire.com/..."
	directURL = extractMediafireLink(html, `id="downloadButton"`)
	if directURL != "" {
		fileName = extractFileName(directURL, html)
		return directURL, fileName, nil
	}

	// Strategy 2: aria-label="Download file"
	directURL = extractMediafireLink(html, `aria-label="Download file"`)
	if directURL != "" {
		fileName = extractFileName(directURL, html)
		return directURL, fileName, nil
	}

	// Strategy 3: class="popsok" (alternative download button class)
	directURL = extractMediafireLink(html, `class="popsok"`)
	if directURL != "" {
		fileName = extractFileName(directURL, html)
		return directURL, fileName, nil
	}

	// Strategy 4: look for any href containing "download" + "mediafire" in the URL
	for _, part := range strings.Split(html, `href="`) {
		end := strings.Index(part, `"`)
		if end == -1 || end > 500 {
			continue
		}
		u := part[:end]
		if strings.Contains(u, "download") && strings.Contains(u, "mediafire") && strings.HasPrefix(u, "http") {
			fileName = extractFileName(u, html)
			return u, fileName, nil
		}
	}

	return "", "", fmt.Errorf("mediafire: could not find download link on page")
}

// extractMediafireLink finds an href near a given marker in the HTML.
func extractMediafireLink(html, marker string) string {
	idx := strings.Index(html, marker)
	if idx == -1 {
		return ""
	}

	// Search in a window around the marker (the <a> tag could have href before or after the marker)
	windowStart := idx - 500
	if windowStart < 0 {
		windowStart = 0
	}
	windowEnd := idx + 500
	if windowEnd > len(html) {
		windowEnd = len(html)
	}
	window := html[windowStart:windowEnd]

	// Find href in this window
	for _, part := range strings.Split(window, `href="`) {
		end := strings.Index(part, `"`)
		if end == -1 || end > 400 {
			continue
		}
		u := part[:end]
		if strings.HasPrefix(u, "http") && (strings.Contains(u, "mediafire") || strings.Contains(u, "download")) {
			return u
		}
	}
	return ""
}

// extractFileName tries to get the filename from the URL or page title.
func extractFileName(url, html string) string {
	// Try from URL path: last segment before /file suffix
	parts := strings.Split(url, "/")
	for i := len(parts) - 1; i >= 0; i-- {
		p := parts[i]
		if strings.Contains(p, ".mp4") || strings.Contains(p, ".mkv") || strings.Contains(p, ".avi") {
			// Remove query string
			if qi := strings.Index(p, "?"); qi != -1 {
				p = p[:qi]
			}
			return p
		}
	}

	// Try from page: <div class="filename">filename.mp4</div>
	if idx := strings.Index(html, `class="filename"`); idx != -1 {
		chunk := html[idx:]
		if gt := strings.Index(chunk, ">"); gt != -1 {
			chunk = chunk[gt+1:]
			if lt := strings.Index(chunk, "<"); lt != -1 && lt < 300 {
				name := strings.TrimSpace(chunk[:lt])
				if name != "" {
					return name
				}
			}
		}
	}

	// Try from <title>
	if idx := strings.Index(html, "<title>"); idx != -1 {
		chunk := html[idx+7:]
		if end := strings.Index(chunk, "</title>"); end != -1 && end < 300 {
			title := strings.TrimSpace(chunk[:end])
			// Mediafire titles are like "filename.mp4 - MediaFire"
			if dash := strings.Index(title, " - "); dash != -1 {
				title = strings.TrimSpace(title[:dash])
			}
			if strings.Contains(title, ".") {
				return title
			}
		}
	}

	return "episode.mp4"
}
