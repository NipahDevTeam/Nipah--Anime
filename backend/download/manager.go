package download

import (
	"bufio"
	"crypto/aes"
	"crypto/cipher"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
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
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
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
func (m *Manager) Start(downloadID int, sourceURL, fileName, animeTitle string, episodeNum float64, referer, cookie string) error {
	m.mu.Lock()
	if _, exists := m.active[downloadID]; exists {
		m.mu.Unlock()
		return fmt.Errorf("download %d already active", downloadID)
	}

	ad := &activeDownload{cancel: make(chan struct{})}
	m.active[downloadID] = ad
	m.mu.Unlock()

	go m.downloadFile(downloadID, sourceURL, fileName, animeTitle, episodeNum, referer, cookie, ad)
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

func (m *Manager) downloadFile(id int, sourceURL, fileName, animeTitle string, episodeNum float64, referer, cookie string, ad *activeDownload) {
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
	if isHLSManifestURL(actualURL) {
		fileName = replaceDownloadExtension(fileName, ".ts")
	}
	filePath := filepath.Join(animeDir, fileName)
	cleanup := func() {
		cleanupPartialDownload(filePath, animeDir)
	}

	if isHLSManifestURL(actualURL) {
		if err := m.downloadHLSFileV2(id, actualURL, filePath, referer, cookie, ad); err != nil {
			cleanup()
			if m.OnFailed != nil {
				m.OnFailed(id, err.Error())
			}
			return
		}
		return
	}

	// Start HTTP download
	req, err := http.NewRequest("GET", actualURL, nil)
	if err != nil {
		if m.OnFailed != nil {
			m.OnFailed(id, fmt.Sprintf("URL inválida: %v", err))
		}
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	if strings.TrimSpace(referer) != "" {
		req.Header.Set("Referer", referer)
	}
	if strings.TrimSpace(cookie) != "" {
		req.Header.Set("Cookie", cookie)
	}

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
				cleanup()
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
			cleanup()
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

func isHLSManifestURL(rawURL string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(rawURL)), ".m3u8")
}

func replaceDownloadExtension(fileName, ext string) string {
	base := strings.TrimSuffix(fileName, filepath.Ext(fileName))
	if strings.TrimSpace(base) == "" {
		return "episode" + ext
	}
	return base + ext
}

func (m *Manager) downloadHLSFile(id int, manifestURL, filePath, referer, cookie string, ad *activeDownload) error {
	playlistURL, segments, err := m.resolveHLSMediaPlaylist(manifestURL, referer, cookie)
	if err != nil {
		return err
	}
	if len(segments) == 0 {
		return fmt.Errorf("playlist sin segmentos descargables")
	}

	file, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("no se pudo crear archivo: %v", err)
	}
	defer file.Close()

	var downloaded int64
	lastReport := time.Now()
	totalSegments := len(segments)
	for index, segment := range segments {
		select {
		case <-ad.cancel:
			file.Close()
			_ = os.Remove(filePath)
			return fmt.Errorf("descarga cancelada")
		default:
		}

		segmentURL := resolveRelativeURL(playlistURL, segment)
		req, err := http.NewRequest("GET", segmentURL, nil)
		if err != nil {
			return fmt.Errorf("segmento inválido: %v", err)
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		if strings.TrimSpace(referer) != "" {
			req.Header.Set("Referer", referer)
		}
		if strings.TrimSpace(cookie) != "" {
			req.Header.Set("Cookie", cookie)
		}

		resp, err := m.client.Do(req)
		if err != nil {
			return fmt.Errorf("descarga HLS fallida: %v", err)
		}
		if resp.StatusCode >= 400 {
			resp.Body.Close()
			return fmt.Errorf("segmento HLS devolvió HTTP %d", resp.StatusCode)
		}

		written, copyErr := copyWithCancel(file, resp.Body, ad.cancel)
		resp.Body.Close()
		if copyErr != nil {
			return copyErr
		}
		downloaded += written

		if m.OnProgress != nil && (time.Since(lastReport) > 500*time.Millisecond || index == totalSegments-1) {
			progress := float64(index+1) / float64(totalSegments) * 100
			m.OnProgress(id, downloaded, 0, progress)
			lastReport = time.Now()
		}
	}

	if m.OnComplete != nil {
		m.OnComplete(id, filePath, downloaded)
	}
	return nil
}

func copyWithCancel(dst io.Writer, src io.Reader, cancel <-chan struct{}) (int64, error) {
	buf := make([]byte, 32*1024)
	var total int64
	for {
		select {
		case <-cancel:
			return total, fmt.Errorf("descarga cancelada")
		default:
		}
		n, readErr := src.Read(buf)
		if n > 0 {
			written, writeErr := dst.Write(buf[:n])
			total += int64(written)
			if writeErr != nil {
				return total, fmt.Errorf("error al escribir: %v", writeErr)
			}
		}
		if readErr == io.EOF {
			return total, nil
		}
		if readErr != nil {
			return total, fmt.Errorf("error de lectura: %v", readErr)
		}
	}
}

func (m *Manager) resolveHLSMediaPlaylist(manifestURL, referer, cookie string) (string, []string, error) {
	currentURL := manifestURL
	for depth := 0; depth < 3; depth++ {
		body, err := m.fetchTextWithHeaders(currentURL, referer, cookie)
		if err != nil {
			return "", nil, err
		}
		if strings.Contains(body, "#EXT-X-KEY") {
			return "", nil, fmt.Errorf("descarga HLS cifrada no soportada todavía")
		}
		if variants := parseHLSVariantPlaylists(body); len(variants) > 0 {
			sort.SliceStable(variants, func(i, j int) bool {
				return variants[i].score > variants[j].score
			})
			currentURL = resolveRelativeURL(currentURL, variants[0].uri)
			continue
		}
		return currentURL, parseHLSMediaSegments(body), nil
	}
	return "", nil, fmt.Errorf("no se pudo resolver el playlist HLS")
}

type hlsKeyInfo struct {
	uri           string
	explicitIV    []byte
	mediaSequence int64
}

func (k *hlsKeyInfo) ivForSegment(index int) []byte {
	if k == nil {
		return nil
	}
	if len(k.explicitIV) == aes.BlockSize {
		iv := make([]byte, aes.BlockSize)
		copy(iv, k.explicitIV)
		return iv
	}
	iv := make([]byte, aes.BlockSize)
	sequence := uint64(k.mediaSequence + int64(index))
	for i := aes.BlockSize - 1; i >= 0 && sequence > 0; i-- {
		iv[i] = byte(sequence & 0xff)
		sequence >>= 8
	}
	return iv
}

func (m *Manager) downloadHLSFileV2(id int, manifestURL, filePath, referer, cookie string, ad *activeDownload) error {
	playlistURL, segments, keyInfo, err := m.resolveHLSMediaPlaylistV2(manifestURL, referer, cookie)
	if err != nil {
		return err
	}
	if len(segments) == 0 {
		return fmt.Errorf("playlist has no downloadable segments")
	}

	file, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("could not create file: %v", err)
	}
	defer file.Close()

	var keyBytes []byte
	if keyInfo != nil {
		keyBytes, err = m.fetchBytesWithHeaders(keyInfo.uri, referer, cookie)
		if err != nil {
			return fmt.Errorf("could not fetch HLS key: %v", err)
		}
		if len(keyBytes) != aes.BlockSize {
			return fmt.Errorf("unsupported HLS key length: %d", len(keyBytes))
		}
	}

	var downloaded int64
	lastReport := time.Now()
	totalSegments := len(segments)
	for index, segment := range segments {
		select {
		case <-ad.cancel:
			file.Close()
			_ = os.Remove(filePath)
			return fmt.Errorf("download cancelled")
		default:
		}

		segmentURL := resolveRelativeURL(playlistURL, segment)
		req, err := http.NewRequest("GET", segmentURL, nil)
		if err != nil {
			return fmt.Errorf("invalid segment URL: %v", err)
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		if strings.TrimSpace(referer) != "" {
			req.Header.Set("Referer", referer)
		}
		if strings.TrimSpace(cookie) != "" {
			req.Header.Set("Cookie", cookie)
		}

		resp, err := m.client.Do(req)
		if err != nil {
			return fmt.Errorf("HLS segment download failed: %v", err)
		}
		if resp.StatusCode >= 400 {
			resp.Body.Close()
			return fmt.Errorf("HLS segment returned HTTP %d", resp.StatusCode)
		}

		if keyInfo != nil {
			segmentData, readErr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if readErr != nil {
				return fmt.Errorf("segment read failed: %v", readErr)
			}
			decrypted, decryptErr := decryptHLSSegment(segmentData, keyBytes, keyInfo.ivForSegment(index))
			if decryptErr != nil {
				return decryptErr
			}
			written, writeErr := file.Write(decrypted)
			if writeErr != nil {
				return fmt.Errorf("write error: %v", writeErr)
			}
			downloaded += int64(written)
		} else {
			written, copyErr := copyWithCancelV2(file, resp.Body, ad.cancel)
			resp.Body.Close()
			if copyErr != nil {
				return copyErr
			}
			downloaded += written
		}

		if m.OnProgress != nil && (time.Since(lastReport) > 500*time.Millisecond || index == totalSegments-1) {
			progress := float64(index+1) / float64(totalSegments) * 100
			m.OnProgress(id, downloaded, 0, progress)
			lastReport = time.Now()
		}
	}

	if m.OnComplete != nil {
		m.OnComplete(id, filePath, downloaded)
	}
	return nil
}

func copyWithCancelV2(dst io.Writer, src io.Reader, cancel <-chan struct{}) (int64, error) {
	buf := make([]byte, 32*1024)
	var total int64
	for {
		select {
		case <-cancel:
			return total, fmt.Errorf("download cancelled")
		default:
		}
		n, readErr := src.Read(buf)
		if n > 0 {
			written, writeErr := dst.Write(buf[:n])
			total += int64(written)
			if writeErr != nil {
				return total, fmt.Errorf("write error: %v", writeErr)
			}
		}
		if readErr == io.EOF {
			return total, nil
		}
		if readErr != nil {
			return total, fmt.Errorf("read error: %v", readErr)
		}
	}
}

func decryptHLSSegment(data, key, iv []byte) ([]byte, error) {
	if len(data) == 0 {
		return data, nil
	}
	if len(key) != aes.BlockSize {
		return nil, fmt.Errorf("unsupported HLS key length: %d", len(key))
	}
	if len(iv) != aes.BlockSize {
		return nil, fmt.Errorf("invalid HLS IV length: %d", len(iv))
	}
	if len(data)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("encrypted HLS segment length is not block-aligned")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("AES init failed: %v", err)
	}
	decrypted := make([]byte, len(data))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(decrypted, data)
	return trimPKCS7Padding(decrypted), nil
}

func trimPKCS7Padding(data []byte) []byte {
	if len(data) == 0 {
		return data
	}
	padding := int(data[len(data)-1])
	if padding <= 0 || padding > aes.BlockSize || padding > len(data) {
		return data
	}
	for _, b := range data[len(data)-padding:] {
		if int(b) != padding {
			return data
		}
	}
	return data[:len(data)-padding]
}

func parseHLSKeyInfo(body, playlistURL string) (*hlsKeyInfo, error) {
	lines := strings.Split(body, "\n")
	var keyLine string
	mediaSequence := int64(0)

	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "#EXT-X-MEDIA-SEQUENCE:") {
			value := strings.TrimSpace(strings.TrimPrefix(line, "#EXT-X-MEDIA-SEQUENCE:"))
			if seq, err := strconv.ParseInt(value, 10, 64); err == nil {
				mediaSequence = seq
			}
		}
		if strings.HasPrefix(line, "#EXT-X-KEY:") {
			keyLine = strings.TrimSpace(strings.TrimPrefix(line, "#EXT-X-KEY:"))
			break
		}
	}

	if keyLine == "" {
		return nil, nil
	}

	attrs := parseHLSAttributeList(keyLine)
	method := strings.ToUpper(strings.TrimSpace(attrs["METHOD"]))
	if method == "" || method == "NONE" {
		return nil, nil
	}
	if method != "AES-128" {
		return nil, fmt.Errorf("encrypted HLS method %s is not supported yet", method)
	}

	keyURI := strings.Trim(attrs["URI"], "\"")
	if keyURI == "" {
		return nil, fmt.Errorf("encrypted HLS playlist did not expose a key URI")
	}

	info := &hlsKeyInfo{
		uri:           resolveRelativeURL(playlistURL, keyURI),
		mediaSequence: mediaSequence,
	}

	rawIV := strings.TrimSpace(attrs["IV"])
	if rawIV != "" {
		rawIV = strings.TrimPrefix(strings.TrimPrefix(rawIV, "0x"), "0X")
		decoded, err := hex.DecodeString(rawIV)
		if err != nil {
			return nil, fmt.Errorf("invalid HLS IV: %v", err)
		}
		if len(decoded) > aes.BlockSize {
			return nil, fmt.Errorf("invalid HLS IV length: %d", len(decoded))
		}
		if len(decoded) < aes.BlockSize {
			padded := make([]byte, aes.BlockSize)
			copy(padded[aes.BlockSize-len(decoded):], decoded)
			decoded = padded
		}
		info.explicitIV = decoded
	}

	return info, nil
}

func parseHLSAttributeList(raw string) map[string]string {
	out := map[string]string{}
	for _, part := range strings.Split(raw, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		out[strings.ToUpper(strings.TrimSpace(key))] = strings.TrimSpace(value)
	}
	return out
}

func (m *Manager) resolveHLSMediaPlaylistV2(manifestURL, referer, cookie string) (string, []string, *hlsKeyInfo, error) {
	currentURL := manifestURL
	for depth := 0; depth < 3; depth++ {
		body, err := m.fetchTextWithHeaders(currentURL, referer, cookie)
		if err != nil {
			return "", nil, nil, err
		}
		if variants := parseHLSVariantPlaylists(body); len(variants) > 0 {
			sort.SliceStable(variants, func(i, j int) bool {
				return variants[i].score > variants[j].score
			})
			currentURL = resolveRelativeURL(currentURL, variants[0].uri)
			continue
		}
		keyInfo, err := parseHLSKeyInfo(body, currentURL)
		if err != nil {
			return "", nil, nil, err
		}
		return currentURL, parseHLSMediaSegments(body), keyInfo, nil
	}
	return "", nil, nil, fmt.Errorf("could not resolve the HLS playlist")
}

func (m *Manager) fetchTextWithHeaders(rawURL, referer, cookie string) (string, error) {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	if strings.TrimSpace(referer) != "" {
		req.Header.Set("Referer", referer)
	}
	if strings.TrimSpace(cookie) != "" {
		req.Header.Set("Cookie", cookie)
	}

	resp, err := m.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func (m *Manager) fetchBytesWithHeaders(rawURL, referer, cookie string) ([]byte, error) {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	if strings.TrimSpace(referer) != "" {
		req.Header.Set("Referer", referer)
	}
	if strings.TrimSpace(cookie) != "" {
		req.Header.Set("Cookie", cookie)
	}

	resp, err := m.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

type hlsVariant struct {
	uri   string
	score int
}

func parseHLSVariantPlaylists(body string) []hlsVariant {
	scanner := bufio.NewScanner(strings.NewReader(body))
	var out []hlsVariant
	currentScore := 0
	expectURI := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "#EXT-X-STREAM-INF:") {
			currentScore = scoreHLSVariantLine(line)
			expectURI = true
			continue
		}
		if expectURI && !strings.HasPrefix(line, "#") {
			out = append(out, hlsVariant{uri: line, score: currentScore})
			expectURI = false
		}
	}
	return out
}

func parseHLSMediaSegments(body string) []string {
	scanner := bufio.NewScanner(strings.NewReader(body))
	out := []string{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		out = append(out, line)
	}
	return out
}

func scoreHLSVariantLine(line string) int {
	score := 0
	if match := regexp.MustCompile(`RESOLUTION=\d+x(\d+)`).FindStringSubmatch(line); len(match) >= 2 {
		if height, err := strconv.Atoi(match[1]); err == nil {
			score += height * 10
		}
	}
	if match := regexp.MustCompile(`BANDWIDTH=(\d+)`).FindStringSubmatch(line); len(match) >= 2 {
		if bandwidth, err := strconv.Atoi(match[1]); err == nil {
			score += bandwidth / 1000
		}
	}
	return score
}

func resolveRelativeURL(baseURL, ref string) string {
	base, err := neturl.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return strings.TrimSpace(ref)
	}
	relative, err := neturl.Parse(strings.TrimSpace(ref))
	if err != nil {
		return strings.TrimSpace(ref)
	}
	return base.ResolveReference(relative).String()
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

func cleanupPartialDownload(filePath, animeDir string) {
	_ = os.Remove(filePath)
	if strings.TrimSpace(animeDir) == "" {
		return
	}
	entries, err := os.ReadDir(animeDir)
	if err == nil && len(entries) == 0 {
		_ = os.Remove(animeDir)
	}
}
