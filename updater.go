package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	appVersion             = "2.5.5"
	githubLatestReleaseAPI = "https://api.github.com/repos/NipahDevTeam/Nipah--Anime/releases/latest"
)

type githubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	ContentType        string `json:"content_type"`
	Size               int64  `json:"size"`
}

type githubRelease struct {
	TagName     string               `json:"tag_name"`
	Name        string               `json:"name"`
	Body        string               `json:"body"`
	HTMLURL     string               `json:"html_url"`
	PublishedAt string               `json:"published_at"`
	Prerelease  bool                 `json:"prerelease"`
	Draft       bool                 `json:"draft"`
	Assets      []githubReleaseAsset `json:"assets"`
}

type AppUpdateInfo struct {
	CurrentVersion string `json:"current_version"`
	LatestVersion  string `json:"latest_version"`
	ReleaseName    string `json:"release_name"`
	Changelog      string `json:"changelog"`
	HTMLURL        string `json:"html_url"`
	PublishedAt    string `json:"published_at"`
	DownloadURL    string `json:"download_url"`
	AssetName      string `json:"asset_name"`
	Available      bool   `json:"available"`
	InstallReady   bool   `json:"install_ready"`
}

func (a *App) CheckForAppUpdate() (*AppUpdateInfo, error) {
	client := &http.Client{Timeout: 18 * time.Second}
	req, err := http.NewRequest(http.MethodGet, githubLatestReleaseAPI, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Nipah-Anime-Updater")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("update check failed: HTTP %d", resp.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}

	latestVersion := normalizeVersion(release.TagName)
	if latestVersion == "" {
		latestVersion = normalizeVersion(release.Name)
	}

	asset := pickInstallerAsset(release.Assets)
	available := compareVersions(appVersion, latestVersion) < 0
	if a != nil && a.db != nil {
		suppressed := normalizeVersion(a.db.GetSetting("update_suppressed_version", ""))
		if compareVersions(appVersion, latestVersion) >= 0 {
			_ = a.db.SetSetting("update_suppressed_version", "")
		} else if suppressed != "" && compareVersions(suppressed, latestVersion) == 0 {
			available = false
		}
	}
	info := &AppUpdateInfo{
		CurrentVersion: appVersion,
		LatestVersion:  latestVersion,
		ReleaseName:    firstNonEmptyUpdate(release.Name, release.TagName, latestVersion),
		Changelog:      strings.TrimSpace(release.Body),
		HTMLURL:        release.HTMLURL,
		PublishedAt:    release.PublishedAt,
		DownloadURL:    asset.BrowserDownloadURL,
		AssetName:      asset.Name,
		Available:      available,
		InstallReady:   asset.BrowserDownloadURL != "",
	}

	return info, nil
}

func (a *App) InstallLatestAppUpdate(downloadURL string, assetName string, latestVersion string) error {
	if goruntime.GOOS != "windows" {
		return fmt.Errorf("automatic installer updates are currently only supported on Windows")
	}
	if strings.TrimSpace(downloadURL) == "" {
		return fmt.Errorf("missing installer download URL")
	}
	if !isAllowedUpdateURL(downloadURL) {
		return fmt.Errorf("unsupported update URL")
	}
	if a != nil && a.db != nil {
		_ = a.db.SetSetting("update_suppressed_version", normalizeVersion(latestVersion))
	}

	tmpDir, err := os.MkdirTemp("", "nipah-update-*")
	if err != nil {
		return err
	}

	fileName := sanitizeUpdateAssetName(assetName)
	if fileName == "" {
		fileName = "Nipah-Anime-installer.exe"
	}
	installerPath := filepath.Join(tmpDir, fileName)

	client := &http.Client{Timeout: 0}
	req, err := http.NewRequest(http.MethodGet, downloadURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Nipah-Anime-Updater")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("installer download failed: HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(installerPath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, resp.Body); err != nil {
		_ = out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}

	cmd := exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-WindowStyle",
		"Hidden",
		"-Command",
		fmt.Sprintf("Start-Sleep -Seconds 2; Start-Process -FilePath '%s' -Verb RunAs", escapePowerShellSingleQuoted(installerPath)),
	)
	cmd.Dir = tmpDir
	if err := cmd.Start(); err != nil {
		return err
	}

	go func() {
		time.Sleep(150 * time.Millisecond)
		if a.ctx != nil {
			wailsruntime.Quit(a.ctx)
		}
	}()

	return nil
}

func pickInstallerAsset(assets []githubReleaseAsset) githubReleaseAsset {
	if goruntime.GOOS != "windows" {
		return githubReleaseAsset{}
	}
	bestScore := -1
	var best githubReleaseAsset
	for _, asset := range assets {
		name := strings.ToLower(asset.Name)
		if !strings.HasSuffix(name, ".exe") {
			continue
		}
		score := 0
		if strings.Contains(name, "installer") {
			score += 4
		}
		if strings.Contains(name, "windows") {
			score += 3
		}
		if strings.Contains(name, "amd64") || strings.Contains(name, "x64") {
			score += 2
		}
		if strings.Contains(name, "nipah") {
			score++
		}
		if score > bestScore {
			bestScore = score
			best = asset
		}
	}
	return best
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(v, "v"), "V"))
	if v == "" {
		return ""
	}
	parts := strings.Split(v, ".")
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if idx := strings.IndexAny(part, "-+"); idx >= 0 {
			part = part[:idx]
		}
		if part == "" {
			part = "0"
		}
		clean = append(clean, part)
	}
	return strings.Join(clean, ".")
}

func compareVersions(current string, latest string) int {
	a := parseVersionParts(current)
	b := parseVersionParts(latest)
	maxLen := len(a)
	if len(b) > maxLen {
		maxLen = len(b)
	}
	for len(a) < maxLen {
		a = append(a, 0)
	}
	for len(b) < maxLen {
		b = append(b, 0)
	}
	for i := 0; i < maxLen; i++ {
		if a[i] < b[i] {
			return -1
		}
		if a[i] > b[i] {
			return 1
		}
	}
	return 0
}

func parseVersionParts(v string) []int {
	v = normalizeVersion(v)
	if v == "" {
		return []int{0}
	}
	parts := strings.Split(v, ".")
	out := make([]int, 0, len(parts))
	for _, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil {
			n = 0
		}
		out = append(out, n)
	}
	return out
}

func sanitizeUpdateAssetName(name string) string {
	name = strings.TrimSpace(filepath.Base(name))
	if name == "" {
		return ""
	}
	replacer := strings.NewReplacer("<", "", ">", "", ":", "", "\"", "", "/", "", "\\", "", "|", "", "?", "", "*", "")
	name = replacer.Replace(name)
	if !strings.HasSuffix(strings.ToLower(name), ".exe") {
		name += ".exe"
	}
	return name
}

func isAllowedUpdateURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	switch host {
	case "github.com", "api.github.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com":
		return true
	default:
		return false
	}
}

func firstNonEmptyUpdate(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func escapePowerShellSingleQuoted(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}
