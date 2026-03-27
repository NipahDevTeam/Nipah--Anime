//go:build windows

package torrent

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

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
}

type StreamManager struct {
	dataDir string
}

func NewStreamManager(dataDir string) (*StreamManager, error) {
	return &StreamManager{dataDir: dataDir}, nil
}

func (m *StreamManager) Close() {}

func (m *StreamManager) PrepareSession(ctx context.Context, magnet, displayTitle string) (*StreamSession, error) {
	return nil, fmt.Errorf("torrent streaming is not available in Windows release builds")
}

func (m *StreamManager) Session(id string) (*StreamSession, bool) {
	return nil, false
}

func (m *StreamManager) StreamHTTP(w http.ResponseWriter, r *http.Request, id string) error {
	return fmt.Errorf("torrent streaming is not available in Windows release builds")
}
