package main

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "golang.org/x/image/webp"
	"miruro/backend/db"
	"miruro/backend/player"
)

func (a *App) cachedLocalEpisodeThumbnailsByID(sourceID, animeID string) map[string]string {
	if a == nil || a.db == nil {
		return map[string]string{}
	}

	entries, err := a.db.GetAnimeWatchHistory(sourceID, animeID)
	if err != nil {
		return map[string]string{}
	}

	out := make(map[string]string, len(entries))
	for _, entry := range entries {
		thumb, ok := normalizedLocalEpisodeThumbnail(entry.EpisodeThumb)
		if !ok {
			continue
		}
		out[strings.TrimSpace(entry.EpisodeID)] = thumb
	}
	return out
}

func (a *App) WarmOnlineEpisodeThumbnail(payload map[string]interface{}) (map[string]interface{}, error) {
	sourceID := stringValue(payload["source_id"])
	episodeID := stringValue(payload["episode_id"])
	if sourceID == "" || episodeID == "" || a == nil || a.db == nil {
		return map[string]interface{}{"status": "invalid"}, nil
	}

	progress, err := a.db.GetOnlineWatchProgress(sourceID, episodeID)
	if err == nil {
		if thumb, ok := normalizedLocalEpisodeThumbnail(progress.EpisodeThumb); ok {
			return map[string]interface{}{
				"status":        "cached",
				"thumbnail_url": thumb,
			}, nil
		}
	}

	warmKey := sourceID + "::" + episodeID
	if !a.beginEpisodeThumbnailWarm(warmKey) {
		return map[string]interface{}{"status": "scheduled"}, nil
	}

	go func(cloned map[string]interface{}) {
		defer a.finishEpisodeThumbnailWarm(warmKey)
		if err := a.tryWarmEpisodeThumbnail(cloned); err != nil {
			log.Debug().Err(err).Str("source", sourceID).Str("episode", episodeID).Msg("warm episode thumbnail skipped")
		}
	}(cloneInterfaceMap(payload))

	return map[string]interface{}{"status": "scheduled"}, nil
}

func (a *App) PrepareOnlineEpisodeThumbnail(payload map[string]interface{}) (map[string]interface{}, error) {
	sourceID := stringValue(payload["source_id"])
	episodeID := stringValue(payload["episode_id"])
	if sourceID == "" || episodeID == "" || a == nil {
		return map[string]interface{}{"status": "invalid"}, nil
	}

	result := map[string]interface{}{
		"status":        "prepared",
		"source_id":     sourceID,
		"episode_id":    episodeID,
		"anime_id":      stringValue(payload["anime_id"]),
		"episode_num":   floatValue(payload["episode_num"]),
		"episode_title": stringValue(payload["episode_title"]),
	}

	anilistID := intValue(payload["anilist_id"])
	episodeNum := floatValue(payload["episode_num"])
	episodeTitle := stringValue(payload["episode_title"])
	coverURL := stringValue(payload["cover_url"])
	thumb, banner, resolvedCover := a.resolveOnlineEpisodeVisuals(
		sourceID,
		stringValue(payload["anime_id"]),
		episodeID,
		coverURL,
		anilistID,
		episodeNum,
		episodeTitle,
	)
	if thumb != "" {
		result["episode_thumbnail"] = thumb
	}
	if banner != "" {
		result["banner_image"] = banner
	}
	if resolvedCover != "" {
		result["cover_url"] = resolvedCover
	}

	targetURL, rawStreamURL, sourceLabel, err := a.resolveEpisodeThumbnailTarget(payload)
	if err != nil {
		if thumb != "" {
			result["source_label"] = firstNonEmptyString(stringValue(payload["source_label"]), sourceLabel, a.onlineSourceName(sourceID))
			return result, nil
		}
		return result, err
	}

	result["proxy_url"] = targetURL
	result["stream_url"] = rawStreamURL
	result["raw_stream_url"] = rawStreamURL
	result["stream_kind"] = inferStreamKind(firstNonEmptyString(rawStreamURL, targetURL))
	result["source_label"] = firstNonEmptyString(stringValue(payload["source_label"]), sourceLabel, a.onlineSourceName(sourceID))
	return result, nil
}

func (a *App) PersistOnlineEpisodeThumbnail(payload map[string]interface{}) (map[string]interface{}, error) {
	sourceID := stringValue(payload["source_id"])
	episodeID := stringValue(payload["episode_id"])
	dataURL := strings.TrimSpace(stringValue(payload["thumbnail_data_url"]))
	if sourceID == "" || episodeID == "" || dataURL == "" || a == nil || a.db == nil {
		return map[string]interface{}{"status": "invalid"}, nil
	}

	if strings.TrimSpace(a.thumbnailDir) == "" {
		a.configureStoragePaths()
	}
	if strings.TrimSpace(a.thumbnailDir) == "" {
		return nil, fmt.Errorf("thumbnail storage path unavailable")
	}

	imageBytes, extension, err := decodeThumbnailDataURL(dataURL)
	if err != nil {
		return nil, err
	}
	if !capturedThumbnailLooksUsable(imageBytes) {
		return map[string]interface{}{"status": "rejected"}, nil
	}
	basePath := filepath.Join(a.thumbnailDir, episodeThumbnailFileStem(sourceID, stringValue(payload["anime_id"]), episodeID))
	outputPath := basePath + extension
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(outputPath, imageBytes, 0o644); err != nil {
		return nil, err
	}

	thumbURL := fileURLForPath(outputPath)
	if thumbURL == "" {
		return nil, fmt.Errorf("failed to convert thumbnail path")
	}
	if err := a.persistEpisodeThumbnailRecord(payload, thumbURL, stringValue(payload["source_label"])); err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"status":        "cached",
		"thumbnail_url": thumbURL,
	}, nil
}

func (a *App) tryWarmEpisodeThumbnail(payload map[string]interface{}) error {
	sourceID := stringValue(payload["source_id"])
	episodeID := stringValue(payload["episode_id"])
	if sourceID == "" || episodeID == "" || a == nil || a.db == nil {
		return fmt.Errorf("missing thumbnail warm identifiers")
	}

	targetURL, rawStreamURL, sourceLabel, err := a.resolveEpisodeThumbnailTarget(payload)
	if err != nil {
		return err
	}
	if strings.TrimSpace(targetURL) == "" {
		return fmt.Errorf("no thumbnail warm target available")
	}

	if strings.TrimSpace(a.thumbnailDir) == "" {
		a.configureStoragePaths()
	}
	if strings.TrimSpace(a.thumbnailDir) == "" {
		return fmt.Errorf("thumbnail storage path unavailable")
	}

	basePath := filepath.Join(a.thumbnailDir, episodeThumbnailFileStem(sourceID, stringValue(payload["anime_id"]), episodeID))
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	savedPath, err := player.CaptureThumbnail(ctx, targetURL, basePath, player.ThumbnailCaptureOptions{})
	if err != nil {
		return err
	}

	thumbURL := fileURLForPath(savedPath)
	if thumbURL == "" {
		return fmt.Errorf("failed to convert thumbnail path")
	}

	if rawStreamURL != "" {
		log.Debug().Str("source", sourceID).Str("episode", episodeID).Str("stream", rawStreamURL).Str("thumbnail", thumbURL).Msg("episode thumbnail cached locally")
	}
	return a.persistEpisodeThumbnailRecord(payload, thumbURL, sourceLabel)
}

func (a *App) resolveEpisodeThumbnailTarget(payload map[string]interface{}) (string, string, string, error) {
	proxyURL := stringValue(payload["proxy_url"])
	streamURL := firstNonEmptyString(
		stringValue(payload["raw_stream_url"]),
		stringValue(payload["stream_url"]),
	)
	sourceLabel := stringValue(payload["source_label"])

	if proxyURL != "" {
		return proxyURL, streamURL, sourceLabel, nil
	}

	referer := stringValue(payload["referer"])
	cookie := stringValue(payload["cookie"])
	if streamURL != "" {
		if referer != "" || cookie != "" {
			return mediaProxyURL(streamURL, referer, cookie), streamURL, sourceLabel, nil
		}
		return streamURL, streamURL, sourceLabel, nil
	}

	if a == nil || a.registry == nil {
		return "", "", sourceLabel, fmt.Errorf("stream resolution unavailable")
	}

	sourceID := stringValue(payload["source_id"])
	episodeID := stringValue(payload["episode_id"])
	if sourceID == "" || episodeID == "" {
		return "", "", sourceLabel, fmt.Errorf("missing stream resolution identifiers")
	}

	src, err := a.registry.GetAnime(sourceID)
	if err != nil {
		return "", "", sourceLabel, err
	}

	streams, err := a.cachedAnimeStreams(src, sourceID, episodeID)
	if err != nil || len(streams) == 0 {
		if err != nil {
			return "", "", sourceLabel, err
		}
		return "", "", sourceLabel, fmt.Errorf("no stream sources available")
	}

	best, ok := pickBestAnimeStream(streams, a.preferredAnimeAudioForEpisode(episodeID), a.preferredAnimeQuality(stringValue(payload["quality"])))
	if !ok {
		return "", "", sourceLabel, fmt.Errorf("no preferred stream available")
	}

	return mediaProxyURL(best.URL, best.Referer, best.Cookie), best.URL, firstNonEmptyString(sourceLabel, src.Name()), nil
}

func (a *App) beginEpisodeThumbnailWarm(key string) bool {
	a.thumbnailWarmMu.Lock()
	defer a.thumbnailWarmMu.Unlock()

	if a.thumbnailWarmInFlight == nil {
		a.thumbnailWarmInFlight = map[string]struct{}{}
	}
	if _, exists := a.thumbnailWarmInFlight[key]; exists {
		return false
	}
	a.thumbnailWarmInFlight[key] = struct{}{}
	return true
}

func (a *App) finishEpisodeThumbnailWarm(key string) {
	a.thumbnailWarmMu.Lock()
	defer a.thumbnailWarmMu.Unlock()

	delete(a.thumbnailWarmInFlight, key)
}

func (a *App) persistEpisodeThumbnailRecord(payload map[string]interface{}, thumbURL, sourceLabel string) error {
	if a == nil || a.db == nil {
		return fmt.Errorf("watch history unavailable")
	}

	sourceID := stringValue(payload["source_id"])
	episodeID := stringValue(payload["episode_id"])
	saved, _ := a.db.GetOnlineWatchProgress(sourceID, episodeID)
	entry := db.WatchHistoryEntry{
		AniListID:    firstNonZeroInt(intValue(payload["anilist_id"]), saved.AniListID),
		SourceID:     sourceID,
		SourceName:   firstNonEmptyString(stringValue(payload["source_label"]), sourceLabel, saved.SourceName, a.onlineSourceName(sourceID)),
		AnimeID:      firstNonEmptyString(stringValue(payload["anime_id"]), saved.AnimeID),
		AnimeTitle:   firstNonEmptyString(stringValue(payload["anime_title"]), saved.AnimeTitle),
		CoverURL:     firstNonEmptyString(stringValue(payload["cover_url"]), saved.CoverURL),
		EpisodeID:    episodeID,
		EpisodeNum:   firstNonZeroFloat(floatValue(payload["episode_num"]), saved.EpisodeNum),
		EpisodeTitle: firstNonEmptyString(stringValue(payload["episode_title"]), saved.EpisodeTitle),
		EpisodeThumb: thumbURL,
		ProgressSec:  saved.ProgressSec,
		DurationSec:  saved.DurationSec,
		Completed:    saved.Completed,
	}
	if entry.AnimeID == "" {
		entry.AnimeID = stringValue(payload["anime_id"])
	}
	if entry.EpisodeTitle == "" {
		entry.EpisodeTitle = stringValue(payload["episode_title"])
	}
	if entry.AnimeTitle == "" {
		entry.AnimeTitle = stringValue(payload["anime_title"])
	}
	if entry.SourceName == "" {
		entry.SourceName = firstNonEmptyString(sourceLabel, a.onlineSourceName(sourceID))
	}
	if entry.CoverURL == "" {
		entry.CoverURL = stringValue(payload["cover_url"])
	}

	if err := a.db.RecordOnlineWatch(entry); err != nil {
		return err
	}
	a.emitOnlineWatchHistoryChanged(false)
	return nil
}

func decodeThumbnailDataURL(raw string) ([]byte, string, error) {
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "data:image/") {
		return nil, "", fmt.Errorf("invalid thumbnail data url")
	}
	header, encoded, ok := strings.Cut(trimmed, ",")
	if !ok {
		return nil, "", fmt.Errorf("invalid thumbnail data url")
	}
	if !strings.Contains(strings.ToLower(header), ";base64") {
		return nil, "", fmt.Errorf("thumbnail data url must be base64 encoded")
	}

	var extension string
	switch {
	case strings.Contains(strings.ToLower(header), "image/png"):
		extension = ".png"
	case strings.Contains(strings.ToLower(header), "image/webp"):
		extension = ".webp"
	case strings.Contains(strings.ToLower(header), "image/gif"):
		extension = ".gif"
	case strings.Contains(strings.ToLower(header), "image/jpeg"), strings.Contains(strings.ToLower(header), "image/jpg"):
		extension = ".jpg"
	default:
		return nil, "", fmt.Errorf("unsupported thumbnail media type")
	}

	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, "", err
	}
	return decoded, extension, nil
}

func normalizedLocalEpisodeThumbnail(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false
	}

	path := ""
	switch {
	case strings.HasPrefix(strings.ToLower(trimmed), "file://"):
		path = localPathFromThumbnailRef(trimmed)
	case filepath.IsAbs(trimmed):
		path = trimmed
	default:
		return "", false
	}
	if path == "" {
		return "", false
	}
	if info, err := os.Stat(path); err != nil || info.IsDir() {
		return "", false
	}
	if !localThumbnailLooksUsable(path) {
		return "", false
	}
	return fileURLForPath(path), true
}

func localThumbnailLooksUsable(path string) bool {
	imageBytes, err := os.ReadFile(path)
	if err != nil || len(imageBytes) == 0 {
		return false
	}

	decoded, _, err := image.Decode(bytes.NewReader(imageBytes))
	if err != nil {
		return true
	}
	return imageLooksUsable(decoded)
}

func imageLooksUsable(img image.Image) bool {
	if img == nil {
		return false
	}

	bounds := img.Bounds()
	if bounds.Empty() {
		return false
	}

	width := bounds.Dx()
	height := bounds.Dy()
	if width <= 0 || height <= 0 {
		return false
	}

	sampleStepX := maxThumbnailSampleInt(1, width/32)
	sampleStepY := maxThumbnailSampleInt(1, height/32)
	var sampleCount int
	var totalLuminance float64
	var totalLuminanceSq float64
	var minLuminance float64 = 255
	var maxLuminance float64
	var darkSamples int
	var colorfulSamples int

	for y := bounds.Min.Y; y < bounds.Max.Y; y += sampleStepY {
		for x := bounds.Min.X; x < bounds.Max.X; x += sampleStepX {
			r16, g16, b16, a16 := img.At(x, y).RGBA()
			if a16 < 0x1010 {
				continue
			}
			r := float64(r16 >> 8)
			g := float64(g16 >> 8)
			b := float64(b16 >> 8)
			luminance := (r * 0.2126) + (g * 0.7152) + (b * 0.0722)
			totalLuminance += luminance
			totalLuminanceSq += luminance * luminance
			if luminance < minLuminance {
				minLuminance = luminance
			}
			if luminance > maxLuminance {
				maxLuminance = luminance
			}
			if luminance < 8 {
				darkSamples += 1
			}
			maxChannel := r
			if g > maxChannel {
				maxChannel = g
			}
			if b > maxChannel {
				maxChannel = b
			}
			minChannel := r
			if g < minChannel {
				minChannel = g
			}
			if b < minChannel {
				minChannel = b
			}
			if (maxChannel - minChannel) > 14 {
				colorfulSamples += 1
			}
			sampleCount += 1
		}
	}

	if sampleCount == 0 {
		return false
	}

	averageLuminance := totalLuminance / float64(sampleCount)
	variance := (totalLuminanceSq / float64(sampleCount)) - (averageLuminance * averageLuminance)
	dynamicRange := maxLuminance - minLuminance
	darkRatio := float64(darkSamples) / float64(sampleCount)
	colorfulRatio := float64(colorfulSamples) / float64(sampleCount)

	if averageLuminance < 4 {
		return false
	}
	if darkRatio > 0.995 && dynamicRange < 10 && variance < 20 {
		return false
	}
	if darkRatio > 0.94 && averageLuminance < 26 && colorfulRatio < 0.05 {
		return false
	}
	return true
}

func capturedThumbnailLooksUsable(imageBytes []byte) bool {
	decoded, _, err := image.Decode(bytes.NewReader(imageBytes))
	if err != nil {
		return false
	}
	return imageLooksUsable(decoded)
}

func localPathFromThumbnailRef(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	path := parsed.Path
	if len(path) >= 3 && path[0] == '/' && path[2] == ':' {
		path = path[1:]
	}
	return filepath.FromSlash(path)
}

func fileURLForPath(path string) string {
	absolute, err := filepath.Abs(strings.TrimSpace(path))
	if err != nil || absolute == "" {
		return ""
	}
	slashed := filepath.ToSlash(absolute)
	if filepath.VolumeName(absolute) != "" && !strings.HasPrefix(slashed, "/") {
		slashed = "/" + slashed
	}
	return (&url.URL{Scheme: "file", Path: slashed}).String()
}

func episodeThumbnailFileStem(sourceID, animeID, episodeID string) string {
	sum := sha1.Sum([]byte(strings.Join([]string{sourceID, animeID, episodeID}, "::")))
	return hex.EncodeToString(sum[:])
}

func cloneInterfaceMap(source map[string]interface{}) map[string]interface{} {
	cloned := make(map[string]interface{}, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func firstNonZeroFloat(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func firstNonZeroInt(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func maxThumbnailSampleInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func floatValue(raw interface{}) float64 {
	switch value := raw.(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case int32:
		return float64(value)
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err == nil {
			return parsed
		}
	}
	return 0
}

func intValue(raw interface{}) int {
	switch value := raw.(type) {
	case int:
		return value
	case int64:
		return int(value)
	case int32:
		return int(value)
	case float64:
		return int(value)
	case float32:
		return int(value)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err == nil {
			return parsed
		}
	}
	return 0
}

func stringValue(raw interface{}) string {
	switch value := raw.(type) {
	case string:
		return strings.TrimSpace(value)
	case fmt.Stringer:
		return strings.TrimSpace(value.String())
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}
