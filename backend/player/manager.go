// Package player handles communication with external video players.
// Nipah! never plays video itself — it delegates entirely to MPV via subprocess.
// Communication happens over MPV's JSON IPC socket (named pipe on Windows,
// Unix socket on Linux/Mac). The video binary never passes through our process.
package player

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	neturl "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	PlayerMPV = "mpv"
	PlayerVLC = "vlc"
)

func ipcPath() string {
	if runtime.GOOS == "windows" {
		return `\\.\pipe\nipah-mpv`
	}
	return "/tmp/nipah-mpv.sock"
}

func originFromURL(raw string) string {
	u, err := neturl.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// ─────────────────────────────────────────────────────────────────────────────
// PlaybackState
// ─────────────────────────────────────────────────────────────────────────────

type PlaybackState struct {
	mu           sync.RWMutex
	Active       bool    `json:"active"`
	FilePath     string  `json:"file_path"`
	EpisodeID    int     `json:"episode_id"`
	EpisodeNum   float64 `json:"episode_num"`
	AnimeTitle   string  `json:"anime_title"`
	EpisodeTitle string  `json:"episode_title"`
	PositionSec  float64 `json:"position_sec"`
	DurationSec  float64 `json:"duration_sec"`
	Paused       bool    `json:"paused"`
	Percent      float64 `json:"percent"`
}

type PlaybackSnapshot struct {
	Active       bool
	FilePath     string
	EpisodeID    int
	EpisodeNum   float64
	AnimeTitle   string
	EpisodeTitle string
	PositionSec  float64
	DurationSec  float64
	Paused       bool
	Percent      float64
}

func (s *PlaybackState) Snapshot() map[string]interface{} {
	snap := s.Copy()
	return map[string]interface{}{
		"active":        snap.Active,
		"file_path":     snap.FilePath,
		"episode_id":    snap.EpisodeID,
		"episode_num":   snap.EpisodeNum,
		"anime_title":   snap.AnimeTitle,
		"episode_title": snap.EpisodeTitle,
		"position_sec":  snap.PositionSec,
		"duration_sec":  snap.DurationSec,
		"paused":        snap.Paused,
		"percent":       snap.Percent,
	}
}

func (s *PlaybackState) Copy() PlaybackSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return PlaybackSnapshot{
		Active:       s.Active,
		FilePath:     s.FilePath,
		EpisodeID:    s.EpisodeID,
		EpisodeNum:   s.EpisodeNum,
		AnimeTitle:   s.AnimeTitle,
		EpisodeTitle: s.EpisodeTitle,
		PositionSec:  s.PositionSec,
		DurationSec:  s.DurationSec,
		Paused:       s.Paused,
		Percent:      s.Percent,
	}
}

func (s *PlaybackState) update(fn func(*PlaybackState)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(s)
}

func (s *PlaybackState) clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Reset fields individually — never zero the whole struct as that
	// destroys the embedded RWMutex and causes "unlock of unlocked mutex" panics.
	s.Active = false
	s.FilePath = ""
	s.EpisodeID = 0
	s.EpisodeNum = 0
	s.AnimeTitle = ""
	s.EpisodeTitle = ""
	s.PositionSec = 0
	s.DurationSec = 0
	s.Paused = false
	s.Percent = 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Manager
// ─────────────────────────────────────────────────────────────────────────────

type ProgressCallback func(episodeID int, positionSec float64, percent float64)
type EndedCallback func(episodeID int)
type StateCallback func(snapshot PlaybackSnapshot)

type mpvMessage struct {
	Event     string          `json:"event"`
	Name      string          `json:"name"`
	Data      json.RawMessage `json:"data"`
	RequestID int64           `json:"request_id"`
	Error     string          `json:"error"`
}

type mpvCommand struct {
	Command   []interface{} `json:"command"`
	RequestID int64         `json:"request_id"`
}

type Manager struct {
	preferred     string
	anime4K       string
	State         PlaybackState
	conn          net.Conn
	connMu        sync.Mutex
	reqID         atomic.Int64
	OnProgress    ProgressCallback
	OnEnded       EndedCallback
	OnStateChange StateCallback
	mpris         mprisBridge
}

func NewManager(preferred string, anime4KLevel ...string) *Manager {
	if preferred == "" {
		preferred = PlayerMPV
	}
	level := "off"
	if len(anime4KLevel) > 0 && anime4KLevel[0] != "" {
		level = anime4KLevel[0]
	}
	m := &Manager{preferred: preferred, anime4K: level}
	m.mpris = newMPRISBridge(m)
	return m
}

func (m *Manager) SetAnime4KLevel(level string) {
	m.anime4K = level
}

func (m *Manager) emitStateChange() {
	if m.OnStateChange != nil {
		m.OnStateChange(m.State.Copy())
	}
}

func (m *Manager) updateState(fn func(*PlaybackState)) {
	m.State.update(fn)
	m.emitStateChange()
}

func (m *Manager) clearState() {
	m.State.clear()
	m.emitStateChange()
}

// OpenEpisode launches MPV with IPC enabled, then connects to track playback.
// Optional referer is passed as HTTP header for streams that require it (e.g. kwik→uwucdn).
func (m *Manager) OpenEpisode(filePath string, episodeID int, episodeNum float64, animeTitle, episodeTitle string, startSec float64, referer ...string) error {
	bin, err := findBinary(PlayerMPV)
	if err != nil {
		return fmt.Errorf("MPV not found — install from https://mpv.io: %w", err)
	}

	if runtime.GOOS != "windows" {
		_ = os.Remove(ipcPath())
	}

	// For HTTP stream URLs we have already resolved the direct CDN link ourselves.
	// Enabling yt-dlp on a pre-resolved URL causes two problems:
	//   1. yt-dlp may recognise the CDN domain (tapecontent.net for Streamtape,
	//      a*.mp4upload.com for MP4Upload, etc.) and attempt its own extraction,
	//      which fails on raw CDN links and causes MPV to exit silently.
	//   2. Even when yt-dlp passes the URL through, the extra round-trip adds
	//      latency and can trigger anti-hotlink checks on the CDN.
	// yt-dlp is only useful for local files or unresolved site URLs.
	isHTTPStream := strings.HasPrefix(filePath, "http://") || strings.HasPrefix(filePath, "https://")

	args := []string{
		fmt.Sprintf("--input-ipc-server=%s", ipcPath()),
		"--keep-open=yes",
		"--force-window=immediate",
		"--cache=yes",
		"--demuxer-max-bytes=50MiB",
		"--demuxer-readahead-secs=20",
		"--network-timeout=30",
		filePath,
	}
	if shaderArgs := anime4KShaderArgs(m.anime4K); len(shaderArgs) > 0 {
		args = append(shaderArgs, args...)
	}
	if isHTTPStream {
		// Pre-resolved CDN URL — tell MPV to play it directly, no yt-dlp.
		args = append(args[:len(args)-1], "--ytdl=no", filePath)
	} else {
		// Local file — yt-dlp useful for format selection / metadata.
		args = append(args[:len(args)-1],
			"--ytdl=yes",
			"--ytdl-format=bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
			filePath,
		)
	}

	headerFields := []string{
		"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
	}
	if len(referer) > 0 && referer[0] != "" {
		headerFields = append(headerFields, fmt.Sprintf("Referer: %s", referer[0]))
		if origin := originFromURL(referer[0]); origin != "" {
			headerFields = append(headerFields, fmt.Sprintf("Origin: %s", origin))
		}
	}
	// Use --http-header-fields-append per header instead of comma-joining.
	// MPV's list parser splits on commas, and the User-Agent value contains
	// commas (e.g. "(KHTML, like Gecko)") which breaks the parsing.
	for _, hf := range headerFields {
		args = append([]string{
			fmt.Sprintf("--http-header-fields-append=%s", hf),
		}, args...)
	}
	if len(referer) > 0 && referer[0] != "" {
		args = append([]string{
			fmt.Sprintf("--referrer=%s", referer[0]),
		}, args...)
	}

	// On Windows, help MPV find yt-dlp — but only when we actually use it (local files).
	if !isHTTPStream {
		if ytdlpPath := findYtdlp(); ytdlpPath != "" {
			args = append(args[:len(args)-1],
				fmt.Sprintf("--ytdl-raw-options=yt-dlp-path=%s", ytdlpPath),
				filePath,
			)
		}
	}
	// Only add --start if resuming mid-episode
	if startSec > 0 {
		args = append(args, fmt.Sprintf("--start=%f", startSec))
	}

	// Launch MPV — on Windows use CREATE_NEW_CONSOLE so it gets its own visible window
	cmd := exec.Command(bin, args...)
	applyPlatformCmdOptions(cmd)

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start MPV: %w", err)
	}

	m.updateState(func(s *PlaybackState) {
		s.Active = true
		s.FilePath = filePath
		s.EpisodeID = episodeID
		s.EpisodeNum = episodeNum
		s.AnimeTitle = animeTitle
		s.EpisodeTitle = episodeTitle
		s.PositionSec = startSec
	})

	go func() {
		var endedOnce sync.Once
		finishPlayback := func() {
			endedOnce.Do(func() {
				if m.OnEnded != nil {
					m.OnEnded(episodeID)
				}
			})
		}

		defer func() {
			_ = cmd.Wait()
			m.clearState()
			m.disconnectIPC()
			finishPlayback()
		}()

		if err := m.waitForSocket(8 * time.Second); err != nil {
			return
		}
		if err := m.connectIPC(); err != nil {
			return
		}

		m.observeProperty(1, "time-pos")
		m.observeProperty(2, "duration")
		m.observeProperty(3, "pause")
		m.observeProperty(4, "percent-pos")

		m.runEventLoop(episodeID, finishPlayback)
	}()

	return nil
}

func (m *Manager) IsAvailable() bool {
	_, err := findBinary(m.preferred)
	return err == nil
}

func (m *Manager) TogglePause() error {
	return m.sendCommand("cycle", "pause")
}

func (m *Manager) SetPaused(paused bool) error {
	return m.sendCommand("set_property", "pause", paused)
}

func (m *Manager) Pause() error {
	return m.SetPaused(true)
}

func (m *Manager) Play() error {
	return m.SetPaused(false)
}

func (m *Manager) Seek(seconds float64) error {
	return m.sendCommand("seek", seconds, "absolute")
}

func (m *Manager) Stop() error {
	return m.sendCommand("stop")
}

func (m *Manager) Quit() error {
	return m.sendCommand("quit")
}

func (m *Manager) Close() error {
	m.disconnectIPC()
	if m.mpris != nil {
		return m.mpris.Close()
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC internals
// ─────────────────────────────────────────────────────────────────────────────

func (m *Manager) waitForSocket(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if runtime.GOOS == "windows" {
			f, err := os.OpenFile(ipcPath(), os.O_RDWR, os.ModeNamedPipe)
			if err == nil {
				f.Close()
				return nil
			}
		} else {
			if _, err := os.Stat(ipcPath()); err == nil {
				return nil
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("timeout waiting for MPV socket")
}

func (m *Manager) connectIPC() error {
	m.connMu.Lock()
	defer m.connMu.Unlock()

	var conn net.Conn
	var err error

	if runtime.GOOS == "windows" {
		conn, err = dialWindowsPipe(ipcPath())
	} else {
		conn, err = net.Dial("unix", ipcPath())
	}
	if err != nil {
		return fmt.Errorf("IPC dial: %w", err)
	}
	m.conn = conn
	return nil
}

func (m *Manager) disconnectIPC() {
	m.connMu.Lock()
	defer m.connMu.Unlock()
	if m.conn != nil {
		_ = m.conn.Close()
		m.conn = nil
	}
}

func (m *Manager) sendCommand(args ...interface{}) error {
	m.connMu.Lock()
	defer m.connMu.Unlock()
	if m.conn == nil {
		return fmt.Errorf("IPC not connected")
	}
	id := m.reqID.Add(1)
	data, err := json.Marshal(mpvCommand{Command: args, RequestID: id})
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = m.conn.Write(data)
	return err
}

func (m *Manager) observeProperty(id int, prop string) {
	_ = m.sendCommand("observe_property", id, prop)
}

func (m *Manager) runEventLoop(episodeID int, onEnd func()) {
	m.connMu.Lock()
	conn := m.conn
	m.connMu.Unlock()
	if conn == nil {
		return
	}

	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		var msg mpvMessage
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			continue
		}

		if msg.Event == "end-file" {
			if onEnd != nil {
				onEnd()
			}
			return
		}

		if msg.Event != "property-change" {
			continue
		}

		switch msg.Name {
		case "time-pos":
			var pos float64
			if len(msg.Data) > 0 && json.Unmarshal(msg.Data, &pos) == nil {
				m.updateState(func(s *PlaybackState) { s.PositionSec = pos })
				if m.OnProgress != nil {
					snap := m.State.Copy()
					m.OnProgress(episodeID, pos, snap.Percent)
				}
			}
		case "duration":
			var dur float64
			if len(msg.Data) > 0 && json.Unmarshal(msg.Data, &dur) == nil {
				m.updateState(func(s *PlaybackState) { s.DurationSec = dur })
			}
		case "pause":
			var paused bool
			if len(msg.Data) > 0 && json.Unmarshal(msg.Data, &paused) == nil {
				m.updateState(func(s *PlaybackState) { s.Paused = paused })
			}
		case "percent-pos":
			var pct float64
			if len(msg.Data) > 0 && json.Unmarshal(msg.Data, &pct) == nil {
				m.updateState(func(s *PlaybackState) { s.Percent = pct })
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows named pipe
// ─────────────────────────────────────────────────────────────────────────────

func dialWindowsPipe(path string) (net.Conn, error) {
	f, err := os.OpenFile(path, os.O_RDWR, os.ModeNamedPipe)
	if err != nil {
		return nil, fmt.Errorf("open pipe %s: %w", path, err)
	}
	return &pipeConn{f: f}, nil
}

type pipeConn struct{ f *os.File }

func (p *pipeConn) Read(b []byte) (int, error)         { return p.f.Read(b) }
func (p *pipeConn) Write(b []byte) (int, error)        { return p.f.Write(b) }
func (p *pipeConn) Close() error                       { return p.f.Close() }
func (p *pipeConn) LocalAddr() net.Addr                { return pipeAddr(p.f.Name()) }
func (p *pipeConn) RemoteAddr() net.Addr               { return pipeAddr(p.f.Name()) }
func (p *pipeConn) SetDeadline(t time.Time) error      { return nil }
func (p *pipeConn) SetReadDeadline(t time.Time) error  { return nil }
func (p *pipeConn) SetWriteDeadline(t time.Time) error { return nil }

type pipeAddr string

func (a pipeAddr) Network() string { return "pipe" }
func (a pipeAddr) String() string  { return string(a) }

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func toFloat(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	}
	return 0, false
}

func findYtdlp() string {
	candidates := []string{"yt-dlp", "yt-dlp.exe"}
	if home := os.Getenv("USERPROFILE"); home != "" {
		candidates = append(candidates,
			home+`\scoop\apps\yt-dlp\current\yt-dlp.exe`,
			home+`\AppData\Local\Programs\yt-dlp\yt-dlp.exe`,
		)
	}
	for _, c := range candidates {
		if p, err := exec.LookPath(c); err == nil {
			return p
		}
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func findBinary(name string) (string, error) {
	candidates := []string{}

	switch runtime.GOOS {
	case "windows":
		if name == PlayerMPV {
			// Always use mpv.exe explicitly — never mpv.com (console wrapper)
			exeCandidates := []string{}

			// Check bundled mpv first (installed alongside the app)
			if exe, err := os.Executable(); err == nil {
				bundled := filepath.Join(filepath.Dir(exe), "mpv", "mpv.exe")
				exeCandidates = append(exeCandidates, bundled)
			}

			exeCandidates = append(exeCandidates,
				`C:\Program Files\mpv\mpv.exe`,
				`C:\Program Files (x86)\mpv\mpv.exe`,
				`C:\mpv\mpv.exe`,
				`C:\tools\mpv\mpv.exe`,
				`C:\scoop\apps\mpv\current\mpv.exe`,
				`C:\scoop\apps\mpv-git\current\mpv.exe`,
			)
			if home := os.Getenv("USERPROFILE"); home != "" {
				exeCandidates = append(exeCandidates,
					home+`\scoop\apps\mpv\current\mpv.exe`,
					home+`\scoop\apps\mpv-git\current\mpv.exe`,
					home+`\AppData\Local\mpv\mpv.exe`,
					home+`\mpv\mpv.exe`,
				)
			}
			if local := os.Getenv("LOCALAPPDATA"); local != "" {
				exeCandidates = append(exeCandidates, local+`\mpv\mpv.exe`)
			}
			// Check each .exe path directly — skip LookPath which may resolve .com
			for _, c := range exeCandidates {
				if _, err := os.Stat(c); err == nil {
					return c, nil
				}
			}
			return "", fmt.Errorf("mpv.exe not found — set the full path in Ajustes → Reproducción")
		}

	case "darwin":
		if name == PlayerMPV {
			candidates = []string{"/usr/local/bin/mpv", "/opt/homebrew/bin/mpv"}
		}
	case "linux":
		if name == PlayerMPV {
			// Check bundled mpv first (AppImage: mpv lives alongside the binary)
			if exe, err := os.Executable(); err == nil {
				bundled := filepath.Join(filepath.Dir(exe), "mpv")
				candidates = append(candidates, bundled)
			}
			// Also honour $APPDIR set by the AppImage runtime
			if appdir := os.Getenv("APPDIR"); appdir != "" {
				candidates = append(candidates, filepath.Join(appdir, "usr", "bin", "mpv"))
			}
			candidates = append(candidates, "/usr/bin/mpv", "/usr/local/bin/mpv")
		}
	}

	for _, c := range candidates {
		if p, err := exec.LookPath(c); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("%s not found", name)
}
