//go:build windows

package db

import (
	"os"
	"strings"
	"syscall"
	"unsafe"
)

func preferredUILanguage() string {
	if value := windowsLocaleName(); value != "" {
		if lang := normalizeLocaleLanguage(value); lang != "" {
			return lang
		}
	}
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

func windowsLocaleName() string {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GetUserDefaultLocaleName")
	buf := make([]uint16, 85)
	r1, _, _ := proc.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if r1 == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
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
