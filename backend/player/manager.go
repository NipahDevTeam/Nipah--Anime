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
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
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

func (s *PlaybackState) Snapshot() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return map[string]interface{}{
		"active":        s.Active,
		"file_path":     s.FilePath,
		"episode_id":    s.EpisodeID,
		"episode_num":   s.EpisodeNum,
		"anime_title":   s.AnimeTitle,
		"episode_title": s.EpisodeTitle,
		"position_sec":  s.PositionSec,
		"duration_sec":  s.DurationSec,
		"paused":        s.Paused,
		"percent":       s.Percent,
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

type Manager struct {
	preferred  string
	State      PlaybackState
	conn       net.Conn
	connMu     sync.Mutex
	reqID      atomic.Int64
	OnProgress ProgressCallback
	OnEnded    EndedCallback
}

func NewManager(preferred string) *Manager {
	if preferred == "" {
		preferred = PlayerMPV
	}
	return &Manager{preferred: preferred}
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

	args := []string{
		fmt.Sprintf("--input-ipc-server=%s", ipcPath()),
		"--keep-open=yes",
		"--force-window=immediate",
		"--cache=yes",
		"--demuxer-max-bytes=50MiB",
		"--demuxer-readahead-secs=20",
		"--network-timeout=30",
		"--ytdl=yes",
		"--ytdl-format=bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
		filePath,
	}

	// Pass Referer header to MPV for CDNs that require it
	if len(referer) > 0 && referer[0] != "" {
		args = append([]string{
			fmt.Sprintf("--http-header-fields=Referer: %s", referer[0]),
		}, args...)
	}

	// On Windows, help MPV find yt-dlp by adding Scoop and common paths to its search
	if ytdlpPath := findYtdlp(); ytdlpPath != "" {
		args = append(args[:len(args)-1],
			fmt.Sprintf("--ytdl-raw-options=yt-dlp-path=%s", ytdlpPath),
			filePath,
		)
	}
	// Only add --start if resuming mid-episode
	if startSec > 0 {
		args = append(args, fmt.Sprintf("--start=%f", startSec))
	}

	// Launch MPV — on Windows use CREATE_NEW_CONSOLE so it gets its own visible window
	cmd := exec.Command(bin, args...)
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{
			CreationFlags: 0x00000010, // CREATE_NEW_CONSOLE
		}
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start MPV: %w", err)
	}

	m.State.update(func(s *PlaybackState) {
		s.Active = true
		s.FilePath = filePath
		s.EpisodeID = episodeID
		s.EpisodeNum = episodeNum
		s.AnimeTitle = animeTitle
		s.EpisodeTitle = episodeTitle
		s.PositionSec = startSec
	})

	go func() {
		defer func() {
			_ = cmd.Wait()
			m.State.clear()
			m.disconnectIPC()
			if m.OnEnded != nil {
				m.OnEnded(episodeID)
			}
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
		m.observeProperty(5, "eof-reached")

		m.runEventLoop(episodeID)
	}()

	return nil
}

func (m *Manager) IsAvailable() bool {
	_, err := findBinary(m.preferred)
	return err == nil
}

func (m *Manager) Pause() error {
	return m.sendIPC([]interface{}{"cycle", "pause"})
}

func (m *Manager) Seek(seconds float64) error {
	return m.sendIPC([]interface{}{"seek", seconds, "absolute"})
}

func (m *Manager) Quit() error {
	return m.sendIPC([]interface{}{"quit"})
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

func (m *Manager) sendIPC(args []interface{}) error {
	m.connMu.Lock()
	defer m.connMu.Unlock()
	if m.conn == nil {
		return fmt.Errorf("IPC not connected")
	}
	id := m.reqID.Add(1)
	data, err := json.Marshal(map[string]interface{}{
		"command":    args,
		"request_id": id,
	})
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = m.conn.Write(data)
	return err
}

func (m *Manager) observeProperty(id int, prop string) {
	_ = m.sendIPC([]interface{}{"observe_property", id, prop})
}

func (m *Manager) runEventLoop(episodeID int) {
	m.connMu.Lock()
	conn := m.conn
	m.connMu.Unlock()
	if conn == nil {
		return
	}

	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		var event map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}

		if event["event"] != "property-change" {
			if event["event"] == "end-file" {
				return
			}
			continue
		}

		name, _ := event["name"].(string)
		val := event["data"]

		switch name {
		case "time-pos":
			if pos, ok := toFloat(val); ok {
				m.State.update(func(s *PlaybackState) { s.PositionSec = pos })
				if m.OnProgress != nil {
					snap := m.State.Snapshot()
					m.OnProgress(episodeID, pos, snap["percent"].(float64))
				}
			}
		case "duration":
			if dur, ok := toFloat(val); ok {
				m.State.update(func(s *PlaybackState) { s.DurationSec = dur })
			}
		case "pause":
			if paused, ok := val.(bool); ok {
				m.State.update(func(s *PlaybackState) { s.Paused = paused })
			}
		case "percent-pos":
			if pct, ok := toFloat(val); ok {
				m.State.update(func(s *PlaybackState) { s.Percent = pct })
			}
		case "eof-reached":
			if reached, ok := val.(bool); ok && reached {
				if m.OnEnded != nil {
					m.OnEnded(episodeID)
				}
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
			candidates = []string{"/usr/bin/mpv", "/usr/local/bin/mpv"}
		}
	}

	for _, c := range candidates {
		if p, err := exec.LookPath(c); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("%s not found", name)
}
