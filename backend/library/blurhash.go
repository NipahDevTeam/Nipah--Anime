package library

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"strings"
	"time"

	blurhash "github.com/buckket/go-blurhash"
	_ "golang.org/x/image/webp"
)

var blurhashHTTPClient = &http.Client{Timeout: 20 * time.Second}

func computeCoverBlurhash(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}

	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := blurhashHTTPClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ""
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil || len(body) == 0 {
		return ""
	}

	img, err := decodeImage(body)
	if err != nil {
		return ""
	}

	hash, err := blurhash.Encode(4, 3, img)
	if err != nil {
		return ""
	}
	return hash
}

func decodeImage(body []byte) (image.Image, error) {
	if img, _, err := image.Decode(bytes.NewReader(body)); err == nil {
		return img, nil
	}
	if img, err := jpeg.Decode(bytes.NewReader(body)); err == nil {
		return img, nil
	}
	if img, err := png.Decode(bytes.NewReader(body)); err == nil {
		return img, nil
	}
	return nil, fmt.Errorf("unsupported image format")
}
