//go:build windows

package main

import (
	_ "embed"
	"os"
	"path/filepath"
	goruntime "runtime"
	"sync"

	"github.com/tadvi/systray"
)

//go:embed build/windows/icon.ico
var embeddedTrayIconICO []byte

type systrayBackend struct {
	tray     *systray.Systray
	once     sync.Once
	stopOnce sync.Once
}

func newTrayBackend() trayBackend {
	return &systrayBackend{}
}

func (b *systrayBackend) start(controller *trayController) {
	b.once.Do(func() {
		go func() {
			goruntime.LockOSThread()
			defer goruntime.UnlockOSThread()

			tray, err := systray.New()
			if err != nil {
				log.Warn().Err(err).Msg("failed to initialize system tray")
				return
			}
			b.tray = tray

			restoreLabel := "Open Nipah! Anime"
			if err := tray.ShowCustom(trayIconPath(), "Nipah! Anime is still running"); err != nil {
				log.Warn().Err(err).Msg("failed to load custom tray icon, falling back to default")
				if showErr := tray.Show(0, "Nipah! Anime is still running"); showErr != nil {
					log.Warn().Err(showErr).Msg("failed to show tray icon")
					return
				}
			}

			tray.OnClick(func() {
				if err := controller.handleRestore(); err != nil {
					log.Warn().Err(err).Msg("failed to restore resident window from tray click")
				}
			})
			tray.AppendMenu(restoreLabel, func() {
				if err := controller.handleRestore(); err != nil {
					log.Warn().Err(err).Msg("failed to restore resident window from tray menu")
				}
			})
			tray.AppendSeparator()
			tray.AppendMenu("Quit", func() {
				if err := controller.handleQuit(); err != nil {
					log.Warn().Err(err).Msg("failed to quit app from tray menu")
				}
			})

			if err := tray.Run(); err != nil {
				log.Warn().Err(err).Msg("system tray loop exited")
			}
		}()
	})
}

func (b *systrayBackend) stop() {
	b.stopOnce.Do(func() {
		if b.tray == nil {
			return
		}
		if err := b.tray.Stop(); err != nil {
			log.Warn().Err(err).Msg("failed to stop system tray")
		}
	})
}

func trayIconPath() string {
	if iconPath := ensureEmbeddedTrayIcon(); iconPath != "" {
		return iconPath
	}
	execPath, err := os.Executable()
	if err == nil {
		baseDir := filepath.Dir(execPath)
		for _, candidate := range []string{
			filepath.Join(baseDir, "icon.ico"),
			filepath.Join(baseDir, "appicon.png"),
			filepath.Join(baseDir, "appimg.png"),
		} {
			if _, statErr := os.Stat(candidate); statErr == nil {
				return candidate
			}
		}
	}
	for _, candidate := range []string{"build/windows/icon.ico", "appicon.png", "appimg.png"} {
		if _, statErr := os.Stat(candidate); statErr == nil {
			return candidate
		}
	}
	return "build/windows/icon.ico"
}

func ensureEmbeddedTrayIcon() string {
	if len(embeddedTrayIconICO) == 0 {
		return ""
	}
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	iconDir := filepath.Join(cacheDir, "nipah-anime", "tray")
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		return ""
	}
	iconPath := filepath.Join(iconDir, "tray-icon.ico")
	if existing, err := os.ReadFile(iconPath); err == nil && len(existing) == len(embeddedTrayIconICO) {
		return iconPath
	}
	if err := os.WriteFile(iconPath, embeddedTrayIconICO, 0o644); err != nil {
		return ""
	}
	return iconPath
}
