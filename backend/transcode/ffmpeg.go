package transcode

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

const defaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

func originFromURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func BuildInputHeaders(referer, cookie string) string {
	lines := []string{
		"User-Agent: " + defaultUserAgent,
	}
	if trimmed := strings.TrimSpace(referer); trimmed != "" {
		lines = append(lines, "Referer: "+trimmed)
		if origin := originFromURL(trimmed); origin != "" {
			lines = append(lines, "Origin: "+origin)
		}
	}
	if trimmed := strings.TrimSpace(cookie); trimmed != "" {
		lines = append(lines, "Cookie: "+trimmed)
	}
	return strings.Join(lines, "\r\n") + "\r\n"
}

func BuildMP4TranscodeArgs(rawURL, referer, cookie string) []string {
	return []string{
		"-nostdin",
		"-hide_banner",
		"-loglevel", "error",
		"-analyzeduration", "100M",
		"-probesize", "100M",
		"-protocol_whitelist", "file,http,https,tcp,tls,crypto,data",
		"-allowed_extensions", "ALL",
		"-allowed_segment_extensions", "ALL",
		"-extension_picky", "0",
		"-user_agent", defaultUserAgent,
		"-headers", BuildInputHeaders(referer, cookie),
		"-i", rawURL,
		"-map", "0:v:0",
		"-map", "0:a:0?",
		"-sn",
		"-dn",
		"-map_metadata", "-1",
		"-c:v", "copy",
		"-c:a", "aac",
		"-profile:a", "aac_low",
		"-b:a", "128k",
		"-ac", "2",
		"-movflags", "frag_keyframe+empty_moov+faststart+default_base_moof",
		"-f", "mp4",
		"pipe:1",
	}
}

func FindFFmpegBinary(preferred string) (string, error) {
	if resolved := resolvePreferredBinary(preferred); resolved != "" {
		return resolved, nil
	}

	exeDir := ""
	if exePath, err := os.Executable(); err == nil {
		exeDir = filepath.Dir(exePath)
	}
	cwd := ""
	if value, err := os.Getwd(); err == nil {
		cwd = value
	}

	for _, candidate := range candidateFFmpegPaths(runtime.GOOS, exeDir, cwd, os.Getenv("APPDIR"), os.Getenv("LOCALAPPDATA"), os.Getenv("USERPROFILE")) {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}

	if found, err := exec.LookPath("ffmpeg"); err == nil {
		return found, nil
	}
	return "", fmt.Errorf("ffmpeg not found")
}

func FindFFprobeBinary(preferredFFmpeg string) (string, error) {
	if ffmpegPath, err := FindFFmpegBinary(preferredFFmpeg); err == nil {
		candidate := filepath.Join(filepath.Dir(ffmpegPath), ffprobeExecutableName())
		if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	if resolved, err := exec.LookPath("ffprobe"); err == nil {
		return resolved, nil
	}
	return "", fmt.Errorf("ffprobe not found")
}

func ProbeDurationSeconds(preferredFFmpeg, rawURL, referer, cookie string) (float64, error) {
	ffprobePath, err := FindFFprobeBinary(preferredFFmpeg)
	if err != nil {
		return 0, err
	}
	args := []string{
		"-v", "error",
		"-analyzeduration", "100M",
		"-probesize", "100M",
		"-protocol_whitelist", "file,http,https,tcp,tls,crypto,data",
		"-allowed_extensions", "ALL",
		"-allowed_segment_extensions", "ALL",
		"-extension_picky", "0",
		"-headers", BuildInputHeaders(referer, cookie),
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		rawURL,
	}
	output, err := exec.Command(ffprobePath, args...).Output()
	if err != nil {
		return 0, err
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(string(output)), 64)
	if err != nil {
		return 0, err
	}
	if parsed <= 0 {
		return 0, fmt.Errorf("duration unavailable")
	}
	return parsed, nil
}

func CandidateFFmpegPathsForTest(goos, exeDir, cwd, appDir, localAppData, userProfile string) []string {
	return candidateFFmpegPaths(goos, exeDir, cwd, appDir, localAppData, userProfile)
}

func candidateFFmpegPaths(goos, exeDir, cwd, appDir, localAppData, userProfile string) []string {
	candidates := []string{}
	appendCandidate := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		candidates = append(candidates, trimmed)
	}
	appendGlobMatches := func(pattern string) {
		if strings.TrimSpace(pattern) == "" {
			return
		}
		matches, err := filepath.Glob(pattern)
		if err != nil {
			return
		}
		for _, match := range matches {
			appendCandidate(match)
		}
	}

	switch goos {
	case "windows":
		if exeDir != "" {
			appendCandidate(filepath.Join(exeDir, "ffmpeg", "ffmpeg.exe"))
		}
		if cwd != "" {
			appendGlobMatches(filepath.Join(cwd, "build", "tools", "*", "*", "bin", "ffmpeg.exe"))
			appendCandidate(filepath.Join(cwd, "build", "windows", "ffmpeg", "ffmpeg.exe"))
		}
		appendCandidate(`C:\ffmpeg\bin\ffmpeg.exe`)
		appendCandidate(`C:\Program Files\ffmpeg\bin\ffmpeg.exe`)
		appendCandidate(`C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe`)
		appendCandidate(`C:\tools\ffmpeg\bin\ffmpeg.exe`)
		appendCandidate(`C:\ProgramData\chocolatey\bin\ffmpeg.exe`)
		if userProfile != "" {
			appendCandidate(filepath.Join(userProfile, "scoop", "apps", "ffmpeg", "current", "bin", "ffmpeg.exe"))
			appendCandidate(filepath.Join(userProfile, "scoop", "apps", "ffmpeg-essentials", "current", "bin", "ffmpeg.exe"))
			appendCandidate(filepath.Join(userProfile, "ffmpeg", "bin", "ffmpeg.exe"))
		}
		if localAppData != "" {
			appendCandidate(filepath.Join(localAppData, "ffmpeg", "bin", "ffmpeg.exe"))
		}
	case "linux":
		if exeDir != "" {
			appendCandidate(filepath.Join(exeDir, "ffmpeg"))
		}
		if appDir != "" {
			appendCandidate(filepath.Join(appDir, "usr", "bin", "ffmpeg"))
		}
		if cwd != "" {
			appendCandidate(filepath.Join(cwd, "build", "linux-bin", "ffmpeg"))
		}
		appendCandidate("/usr/bin/ffmpeg")
		appendCandidate("/usr/local/bin/ffmpeg")
	case "darwin":
		if exeDir != "" {
			appendCandidate(filepath.Join(exeDir, "ffmpeg"))
		}
		appendCandidate("/opt/homebrew/bin/ffmpeg")
		appendCandidate("/usr/local/bin/ffmpeg")
	}

	return candidates
}

func resolvePreferredBinary(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	if info, err := os.Stat(trimmed); err == nil {
		if info.IsDir() {
			if runtime.GOOS == "windows" {
				candidate := filepath.Join(trimmed, "ffmpeg.exe")
				if stat, statErr := os.Stat(candidate); statErr == nil && !stat.IsDir() {
					return candidate
				}
				return ""
			}
			candidate := filepath.Join(trimmed, "ffmpeg")
			if stat, statErr := os.Stat(candidate); statErr == nil && !stat.IsDir() {
				return candidate
			}
			return ""
		}
		return trimmed
	}

	if runtime.GOOS == "windows" && (strings.Contains(trimmed, `\`) || strings.Contains(trimmed, `/`)) {
		if stat, err := os.Stat(trimmed + ".exe"); err == nil && !stat.IsDir() {
			return trimmed + ".exe"
		}
	}

	if resolved, err := exec.LookPath(trimmed); err == nil {
		return resolved
	}
	return ""
}

func ffprobeExecutableName() string {
	if runtime.GOOS == "windows" {
		return "ffprobe.exe"
	}
	return "ffprobe"
}
