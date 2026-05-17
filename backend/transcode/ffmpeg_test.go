package transcode

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestBuildInputHeadersIncludesRefererOriginAndCookie(t *testing.T) {
	headers := BuildInputHeaders("https://kwik.cx/e/example", "session=abc123")
	if !strings.Contains(headers, "Referer: https://kwik.cx/e/example") {
		t.Fatalf("expected referer header, got %q", headers)
	}
	if !strings.Contains(headers, "Origin: https://kwik.cx") {
		t.Fatalf("expected origin header, got %q", headers)
	}
	if !strings.Contains(headers, "Cookie: session=abc123") {
		t.Fatalf("expected cookie header, got %q", headers)
	}
}

func TestBuildMP4TranscodeArgsUsesAudioTranscodeAndFragmentedMP4(t *testing.T) {
	args := BuildMP4TranscodeArgs("https://example.com/master.m3u8", "https://kwik.cx/e/example", "session=abc123")
	joined := strings.Join(args, " ")
	for _, expected := range []string{
		"-analyzeduration 100M",
		"-probesize 100M",
		"-allowed_extensions ALL",
		"-allowed_segment_extensions ALL",
		"-extension_picky 0",
		"-protocol_whitelist file,http,https,tcp,tls,crypto,data",
		"-c:v copy",
		"-c:a aac",
		"-profile:a aac_low",
		"-f mp4",
		"pipe:1",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected args to contain %q, got %q", expected, joined)
		}
	}
}

func TestCandidateFFmpegPathsForTestIncludesBundledWindowsPath(t *testing.T) {
	paths := CandidateFFmpegPathsForTest("windows", `C:\Program Files\Nipah`, `C:\repo`, "", `C:\Users\me\AppData\Local`, `C:\Users\me`)
	expected := filepath.Join(`C:\Program Files\Nipah`, "ffmpeg", "ffmpeg.exe")
	if len(paths) == 0 || paths[0] != expected {
		t.Fatalf("expected first bundled windows path %q, got %q", expected, strings.Join(paths, ", "))
	}
}

func TestCandidateFFmpegPathsForTestIncludesBundledLinuxPaths(t *testing.T) {
	paths := CandidateFFmpegPathsForTest("linux", "/opt/nipah", "/repo", "/tmp/AppDir", "", "")
	joined := strings.Join(paths, "\n")
	for _, expected := range []string{
		filepath.Join("/opt/nipah", "ffmpeg"),
		filepath.Join("/tmp/AppDir", "usr", "bin", "ffmpeg"),
		"/usr/bin/ffmpeg",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected linux candidates to include %q, got %q", expected, joined)
		}
	}
}

func TestFindFFprobeExecutableName(t *testing.T) {
	name := ffprobeExecutableName()
	if runtime.GOOS == "windows" {
		if name != "ffprobe.exe" {
			t.Fatalf("expected ffprobe.exe on windows, got %q", name)
		}
		return
	}
	if name != "ffprobe" {
		t.Fatalf("expected ffprobe on non-windows, got %q", name)
	}
}
