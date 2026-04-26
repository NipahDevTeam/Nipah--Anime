//go:build !linux && !windows

package torrent

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	gotorrent "github.com/anacrolix/torrent"
)

var playableVideoExts = map[string]struct{}{
	".mkv": {}, ".mp4": {}, ".avi": {}, ".mov": {}, ".wmv": {},
	".webm": {}, ".m4v": {}, ".ts": {}, ".m2ts": {},
}

type StreamSession struct {
	ID           string
	Magnet       string
	DisplayTitle string
	InfoHash     string
	FileIndex    int
	FileName     string
	ContentType  string
	CreatedAt    time.Time
	LastAccessed time.Time
	Torrent      *gotorrent.Torrent
}

type StreamManager struct {
	client  *gotorrent.Client
	dataDir string
	mu      sync.RWMutex
	session map[string]*StreamSession
}

func NewStreamManager(dataDir string) (*StreamManager, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	cfg := gotorrent.NewDefaultClientConfig()
	cfg.DataDir = dataDir
	cfg.Seed = false
	cfg.Debug = false
	client, err := gotorrent.NewClient(cfg)
	if err != nil {
		return nil, err
	}
	return &StreamManager{
		client:  client,
		dataDir: dataDir,
		session: make(map[string]*StreamSession),
	}, nil
}

func (m *StreamManager) Close() {
	if m == nil || m.client == nil {
		return
	}
	m.client.Close()
}

func (m *StreamManager) PrepareSession(ctx context.Context, magnet, displayTitle string) (*StreamSession, error) {
	if m == nil || m.client == nil {
		return nil, fmt.Errorf("torrent stream manager not initialized")
	}
	magnet = strings.TrimSpace(magnet)
	if magnet == "" {
		return nil, fmt.Errorf("missing magnet link")
	}
	sessionID := streamSessionID(magnet)

	m.mu.Lock()
	existing := m.session[sessionID]
	if existing != nil {
		existing.LastAccessed = time.Now()
		m.mu.Unlock()
		return existing, nil
	}
	m.mu.Unlock()

	t, err := m.client.AddMagnet(magnet)
	if err != nil {
		return nil, err
	}
	if displayTitle != "" {
		t.SetDisplayName(displayTitle)
	}

	select {
	case <-t.GotInfo():
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(45 * time.Second):
		return nil, fmt.Errorf("torrent metadata timed out")
	}

	fileIndex, fileName, contentType, err := selectPlayableFile(t)
	if err != nil {
		return nil, err
	}

	file := t.Files()[fileIndex]
	file.Download()

	session := &StreamSession{
		ID:           sessionID,
		Magnet:       magnet,
		DisplayTitle: firstNonEmpty(displayTitle, t.Name(), file.DisplayPath()),
		InfoHash:     t.InfoHash().HexString(),
		FileIndex:    fileIndex,
		FileName:     fileName,
		ContentType:  contentType,
		CreatedAt:    time.Now(),
		LastAccessed: time.Now(),
		Torrent:      t,
	}

	m.mu.Lock()
	m.session[sessionID] = session
	m.mu.Unlock()
	return session, nil
}

func (m *StreamManager) Session(id string) (*StreamSession, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.session[strings.TrimSpace(id)]
	if ok {
		s.LastAccessed = time.Now()
	}
	return s, ok
}

func (m *StreamManager) StreamHTTP(w http.ResponseWriter, r *http.Request, id string) error {
	session, ok := m.Session(id)
	if !ok {
		return fmt.Errorf("torrent session not found")
	}
	files := session.Torrent.Files()
	if session.FileIndex < 0 || session.FileIndex >= len(files) {
		return fmt.Errorf("torrent file is no longer available")
	}

	file := files[session.FileIndex]
	file.Download()
	reader := file.NewReader()
	reader.SetResponsive()
	reader.SetReadahead(8 << 20)
	defer reader.Close()

	w.Header().Set("Content-Type", firstNonEmpty(session.ContentType, detectVideoContentType(file.DisplayPath())))
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, file.DisplayPath(), time.Time{}, reader)
	return nil
}

func streamSessionID(magnet string) string {
	sum := sha1.Sum([]byte(magnet))
	return hex.EncodeToString(sum[:])
}

func selectPlayableFile(t *gotorrent.Torrent) (int, string, string, error) {
	files := t.Files()
	bestIndex := -1
	var bestLength int64
	for i, file := range files {
		path := strings.ToLower(file.DisplayPath())
		ext := strings.ToLower(filepath.Ext(path))
		if _, ok := playableVideoExts[ext]; !ok {
			continue
		}
		if file.Length() > bestLength {
			bestIndex = i
			bestLength = file.Length()
		}
	}
	if bestIndex < 0 {
		return 0, "", "", fmt.Errorf("no playable video file found in torrent")
	}
	file := files[bestIndex]
	return bestIndex, file.DisplayPath(), detectVideoContentType(file.DisplayPath()), nil
}

func detectVideoContentType(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".ts":
		return "video/mp2t"
	case ".mkv":
		return "video/x-matroska"
	default:
		return "application/octet-stream"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
