package main

import (
	"embed"
	"os"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2"

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

	err := wails.Run(newWailsAppOptions(app, processStarted))

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
