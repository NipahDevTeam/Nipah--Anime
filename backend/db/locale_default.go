//go:build !windows

package db

import (
	"os"
	"strings"
)

func preferredUILanguage() string {
	for _, value := range []string{
		os.Getenv("LC_ALL"),
		os.Getenv("LC_MESSAGES"),
		os.Getenv("LANGUAGE"),
		os.Getenv("LANG"),
	} {
		if lang := normalizeLocaleLanguage(value); lang != "" {
			return lang
		}
	}
	return "en"
}

func normalizeLocaleLanguage(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	for _, sep := range []string{".", "@", "_", "-"} {
		if idx := strings.Index(value, sep); idx > 0 {
			value = value[:idx]
			break
		}
	}
	switch value {
	case "es":
		return "es"
	case "en":
		return "en"
	default:
		return ""
	}
}
