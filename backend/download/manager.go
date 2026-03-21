package download

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"miruro/backend/extensions/animeflv"
)

// DownloadStatus represents the state of a download.
type DownloadStatus string

const (
	StatusPending     DownloadStatus = "pending"
	StatusDownloading DownloadStatus = "downloading"
	StatusCompleted   DownloadStatus = "completed"
	StatusFailed      DownloadStatus = "failed"
	StatusCancelled   DownloadStatus = "cancelled"
)

// DownloadItem tracks a single download.
type DownloadItem struct {
	ID           int            `json:"id"`
	AnimeTitle   string         `json:"anime_title"`
	EpisodeNum   float64        `json:"episode_num"`
	EpisodeTitle string         `json:"episode_title"`
	CoverURL     string         `json:"cover_url"`
	SourceURL    string         `json:"source_url"`
	FilePath     string         `json:"file_path"`
	FileName     string         `json:"file_name"`
	FileSize     int64          `json:"file_size"`
	Downloaded   int64          `json:"downloaded"`
	Status       DownloadStatus `json:"status"`
	Error        string         `json:"error,omitempty"`
	Progress     float64        `json:"progress"` // 0-100
	CreatedAt    string         `json:"created_at"`
	CompletedAt  string         `json:"completed_at,omitempty"`
}

// Manager handles downloading files with progress tracking.
type Manager struct {
	mu          sync.Mutex
	active      map[int]*activeDownload
	downloadDir string
	client      *http.Client

	// Callbacks for persisting state
	OnProgress func(id int, downloaded, total int64, progress float64)
	OnComplete func(id int, filePath string, fileSize int64)
	OnFailed   func(id int, errMsg string)
}

type activeDownload struct {
	cancel chan struct{}
}

// NewManager creates a download manager with the given download directory.
func NewManager(downloadDir string) *Manager {
	// Ensure download directory exists
	_ = os.MkdirAll(downloadDir, 0755)

	return &Manager{
		active:      make(map[int]*activeDownload),
		downloadDir: downloadDir,
		client: &http.Client{
			Timeout: 0, // no timeout for downloads
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) > 10 {
					return fmt.Errorf("too many redirects")
				}
				return nil
			},
		},
	}
}

// GetDownloadDir returns the current download directory.
func (m *Manager) GetDownloadDir() string {
	return m.downloadDir
}

// SetDownloadDir changes the download directory.
func (m *Manager) SetDownloadDir(dir string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.downloadDir = dir
	_ = os.MkdirAll(dir, 0755)
}

// Start begins downloading a file in the background.
// The downloadID must be pre-assigned (from DB insert).
func (m *Manager) Start(downloadID int, sourceURL, fileName, animeTitle string, episodeNum float64) error {
	m.mu.Lock()
	if _, exists := m.active[downloadID]; exists {
		m.mu.Unlock()
		return fmt.Errorf("download %d already active", downloadID)
	}

	ad := &activeDownload{cancel: make(chan struct{})}
	m.active[downloadID] = ad
	m.mu.Unlock()

	go m.downloadFile(downloadID, sourceURL, fileName, animeTitle, episodeNum, ad)
	return nil
}

// Cancel stops an active download.
func (m *Manager) Cancel(downloadID int) {
	m.mu.Lock()
	if ad, ok := m.active[downloadID]; ok {
		close(ad.cancel)
		delete(m.active, downloadID)
	}
	m.mu.Unlock()
}

// IsActive checks if a download is currently running.
func (m *Manager) IsActive(downloadID int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.active[downloadID]
	return ok
}

func (m *Manager) downloadFile(id int, sourceURL, fileName, animeTitle string, episodeNum float64, ad *activeDownload) {
	defer func() {
		m.mu.Lock()
		delete(m.active, id)
		m.mu.Unlock()
	}()

	actualURL, resolvedName, err := m.resolveDownloadURL(sourceURL)
	if err != nil {
		if m.OnFailed != nil {
			m.OnFailed(id, err.Error())
		}
		return
	}
	if resolvedName != "" && (fileName == "" || fileName == "episode.mp4") {
		fileName = resolvedName
	}

	// Sanitize filename
	if fileName == "" {
		fileName = fmt.Sprintf("%s - Ep %g.mp4", sanitizeFileName(animeTitle), episodeNum)
	}

	// Create anime subfolder
	animeDir := filepath.Join(m.downloadDir, sanitizeFileName(animeTitle))
	_ = os.MkdirAll(animeDir, 0755)
	filePath := filepath.Join(animeDir, fileName)

	// Start HTTP download
	req, err := http.NewRequest("GET", actualURL, nil)
	if err != nil {
		if m.OnFailed != nil {
			m.OnFailed(id, fmt.Sprintf("URL inválida: %v", err))
		}
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	resp, err := m.client.Do(req)
	if err != nil {
		if m.OnFailed != nil {
			m.OnFailed(id, fmt.Sprintf("Descarga fallida: %v", err))
		}
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		if m.OnFailed != nil {
			m.OnFailed(id, fmt.Sprintf("HTTP %d", resp.StatusCode))
		}
		return
	}

	totalSize := resp.ContentLength

	// Create file
	f, err := os.Create(filePath)
	if err != nil {
		if m.OnFailed != nil {
			m.OnFailed(id, fmt.Sprintf("No se pudo crear archivo: %v", err))
		}
		return
	}
	defer f.Close()

	// Download with progress tracking
	buf := make([]byte, 32*1024) // 32KB buffer
	var downloaded int64
	lastReport := time.Now()

	for {
		select {
		case <-ad.cancel:
			// Clean up partial file
			f.Close()
			os.Remove(filePath)
			return
		default:
		}

		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := f.Write(buf[:n]); writeErr != nil {
				if m.OnFailed != nil {
					m.OnFailed(id, fmt.Sprintf("Error al escribir: %v", writeErr))
				}
				return
			}
			downloaded += int64(n)

			// Report progress every 500ms
			if time.Since(lastReport) > 500*time.Millisecond {
				var progress float64
				if totalSize > 0 {
					progress = float64(downloaded) / float64(totalSize) * 100
				}
				if m.OnProgress != nil {
					m.OnProgress(id, downloaded, totalSize, progress)
				}
				lastReport = time.Now()
			}
		}

		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			if m.OnFailed != nil {
				m.OnFailed(id, fmt.Sprintf("Error de lectura: %v", readErr))
			}
			return
		}
	}

	// Complete
	if m.OnComplete != nil {
		m.OnComplete(id, filePath, downloaded)
	}
}

func (m *Manager) resolveDownloadURL(sourceURL string) (string, string, error) {
	switch {
	case strings.Contains(sourceURL, "jkplayers.com/d/"):
		redirected, err := resolveRedirectURL(sourceURL)
		if err != nil {
			return "", "", fmt.Errorf("No se pudo resolver enlace de JKAnime: %v", err)
		}
		if redirected == "" {
			return "", "", fmt.Errorf("JKAnime no devolvió un destino de descarga válido")
		}
		return m.resolveDownloadURL(redirected)

	case strings.Contains(sourceURL, "mediafire.com"):
		directURL, fileName, err := ResolveMediafire(sourceURL)
		if err != nil {
			return "", "", fmt.Errorf("No se pudo resolver Mediafire: %v", err)
		}
		return directURL, fileName, nil

	case strings.Contains(sourceURL, "mega.nz"), strings.Contains(sourceURL, "mega.co.nz"):
		return "", "", fmt.Errorf("Mega no está soportado para descarga directa en esta versión")

	case strings.Contains(sourceURL, "streamwish"),
		strings.Contains(sourceURL, "wishembed"),
		strings.Contains(sourceURL, "sfastwish"),
		strings.Contains(sourceURL, "awish"),
		strings.Contains(sourceURL, "mp4upload"),
		strings.Contains(sourceURL, "streamtape"),
		strings.Contains(sourceURL, "voe."),
		strings.Contains(sourceURL, "voe.sx"),
		strings.Contains(sourceURL, "dood"),
		strings.Contains(sourceURL, "vidhide"),
		strings.Contains(sourceURL, "streamhide"),
		strings.Contains(sourceURL, "jkplayer/"):
		resolved, err := animeflv.Resolve(sourceURL)
		if err != nil {
			return "", "", fmt.Errorf("No se pudo resolver el host de descarga: %v", err)
		}
		if resolved == nil || resolved.URL == "" {
			return "", "", fmt.Errorf("El host de descarga no devolvió un archivo válido")
		}
		if resolved.Type == "hls" || strings.Contains(strings.ToLower(resolved.URL), ".m3u8") {
			return "", "", fmt.Errorf("Este host expone HLS y no un archivo descargable directo")
		}
		return resolved.URL, "", nil

	default:
		return sourceURL, "", nil
	}
}

func resolveRedirectURL(sourceURL string) (string, error) {
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	req, err := http.NewRequest("HEAD", sourceURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://jkanime.net/")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	return strings.TrimSpace(resp.Header.Get("Location")), nil
}

// sanitizeFileName removes characters that are invalid in file/folder names.
func sanitizeFileName(name string) string {
	replacer := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_",
		"?", "_", "\"", "_", "<", "_", ">", "_", "|", "_",
	)
	result := replacer.Replace(name)
	result = strings.TrimSpace(result)
	if result == "" {
		result = "Unknown"
	}
	return result
}
