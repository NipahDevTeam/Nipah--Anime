package main

import (
	"context"
	"embed"
	"os"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"miruro/backend/db"
	"miruro/backend/logger"
)

var installerLog = logger.For("Installer")

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	processStarted := time.Now()
	if handled, err := handleUtilityMode(); handled {
		if err != nil {
			installerLog.Error().Msg(err.Error())
			os.Exit(1)
		}
		return
	}

	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Nipah! Anime",
		Width:     960,
		Height:    620,
		MinWidth:  920,
		MinHeight: 560,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 10, G: 10, B: 14, A: 1},
		OnStartup: func(ctx context.Context) {
			installerLog.Info().Dur("since_process_start", time.Since(processStarted)).Msg("wails startup callback")
			app.startup(ctx)
		},
		OnDomReady: func(ctx context.Context) {
			installerLog.Info().Dur("since_process_start", time.Since(processStarted)).Msg("wails dom ready callback")
			app.domReady(ctx)
		},
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
		// Platform-specific options
		Windows: &windows.Options{
			WebviewIsTransparent:              false,
			WindowIsTranslucent:               false,
			DisableWindowIcon:                 false,
			DisableFramelessWindowDecorations: false,
			WebviewUserDataPath:               "",
		},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarHiddenInset(),
			Appearance:           mac.DefaultAppearance,
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
			About: &mac.AboutInfo{
				Title:   "Nipah! Anime",
				Message: "A self-hosted anime & manga media server for Latin America.",
			},
		},
		Linux: &linux.Options{
			WindowIsTranslucent: false,
			WebviewGpuPolicy:    linux.WebviewGpuPolicyAlways,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

func handleUtilityMode() (bool, error) {
	for _, arg := range os.Args[1:] {
		if strings.HasPrefix(arg, "--seed-language=") {
			lang := strings.TrimSpace(strings.TrimPrefix(arg, "--seed-language="))
			if lang != "en" {
				lang = "es"
			}

			database, err := db.New()
			if err != nil {
				return true, err
			}
			defer database.Close()

			settings := map[string]string{
				"language":           lang,
				"preferred_sub_lang": lang,
			}
			if err := database.SetSettings(settings); err != nil {
				return true, err
			}
			installerLog.Info().Str("language", lang).Msg("seeded language")
			return true, nil
		}
	}

	return false, nil
}
