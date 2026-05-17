package player

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

var ErrThumbnailUnsupported = errors.New("thumbnail capture unsupported")

type ThumbnailCaptureOptions struct {
	Client           *http.Client
	MaxManifestDepth int
	MaxBytes         int64
}

func CaptureThumbnail(ctx context.Context, sourceURL, outputBasePath string, opts ThumbnailCaptureOptions) (string, error) {
	client := opts.Client
	if client == nil {
		client = &http.Client{Timeout: 12 * time.Second}
	}

	maxDepth := opts.MaxManifestDepth
	if maxDepth <= 0 {
		maxDepth = 4
	}

	maxBytes := opts.MaxBytes
	if maxBytes <= 0 {
		maxBytes = 8 << 20
	}

	return captureThumbnailFromURL(ctx, client, sourceURL, outputBasePath, maxDepth, maxBytes, map[string]struct{}{})
}

func captureThumbnailFromURL(ctx context.Context, client *http.Client, currentURL, outputBasePath string, depth int, maxBytes int64, visited map[string]struct{}) (string, error) {
	if depth <= 0 {
		return "", ErrThumbnailUnsupported
	}
	if _, seen := visited[currentURL]; seen {
		return "", ErrThumbnailUnsupported
	}
	visited[currentURL] = struct{}{}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, currentURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", ErrThumbnailUnsupported
	}

	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if looksLikePlaylist(resp.Request.URL.String(), contentType) {
		body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		if err != nil {
			return "", err
		}
		nextURL, ok := firstPlaylistTarget(resp.Request.URL, string(body))
		if !ok {
			return "", ErrThumbnailUnsupported
		}
		return captureThumbnailFromURL(ctx, client, nextURL, outputBasePath, depth-1, maxBytes, visited)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes))
	if err != nil {
		return "", err
	}
	detected := strings.ToLower(http.DetectContentType(body))
	if contentType == "" || strings.Contains(contentType, "application/octet-stream") {
		contentType = detected
	}
	if !looksLikeImage(resp.Request.URL.String(), contentType) {
		return "", ErrThumbnailUnsupported
	}

	extension := imageExtension(resp.Request.URL.String(), contentType)
	if extension == "" {
		extension = ".jpg"
	}
	outputPath := outputBasePath + extension
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(outputPath, body, 0o644); err != nil {
		return "", err
	}
	return outputPath, nil
}

func firstPlaylistTarget(base *url.URL, manifest string) (string, bool) {
	scanner := bufio.NewScanner(strings.NewReader(manifest))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		resolved, err := base.Parse(line)
		if err != nil {
			return "", false
		}
		return resolved.String(), true
	}
	return "", false
}

func looksLikePlaylist(rawURL, contentType string) bool {
	lowerURL := strings.ToLower(strings.TrimSpace(rawURL))
	lowerCT := strings.ToLower(strings.TrimSpace(contentType))
	return strings.Contains(lowerURL, ".m3u8") ||
		strings.Contains(lowerCT, "application/vnd.apple.mpegurl") ||
		strings.Contains(lowerCT, "application/x-mpegurl")
}

func looksLikeImage(rawURL, contentType string) bool {
	lowerCT := strings.ToLower(strings.TrimSpace(contentType))
	if strings.HasPrefix(lowerCT, "image/") {
		return true
	}
	switch strings.ToLower(path.Ext(rawURL)) {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif":
		return true
	default:
		return false
	}
}

func imageExtension(rawURL, contentType string) string {
	switch {
	case strings.Contains(contentType, "image/png"):
		return ".png"
	case strings.Contains(contentType, "image/webp"):
		return ".webp"
	case strings.Contains(contentType, "image/gif"):
		return ".gif"
	case strings.Contains(contentType, "image/jpeg"):
		return ".jpg"
	}

	switch strings.ToLower(path.Ext(rawURL)) {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif":
		return strings.ToLower(path.Ext(rawURL))
	default:
		return ""
	}
}
