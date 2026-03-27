package notify

import (
	"strings"

	"github.com/gen2brain/beeep"
)

func Desktop(title, message string) error {
	title = strings.TrimSpace(title)
	message = strings.TrimSpace(message)
	if title == "" || message == "" {
		return nil
	}
	return beeep.Notify(title, message, "")
}
