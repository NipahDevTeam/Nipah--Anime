package logger

import (
	"os"

	"github.com/rs/zerolog"
)

// Root is the application-wide base logger.
var Root zerolog.Logger

// Init sets up zerolog with a pretty console writer.
// Call once at app startup before any logging.
func Init(debug bool) {
	level := zerolog.InfoLevel
	if debug {
		level = zerolog.DebugLevel
	}
	Root = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr}).
		With().Timestamp().Logger().Level(level)
}

// For creates a sub-logger tagged with a source name.
// Usage: var log = logger.For("AnimeFLV")
func For(source string) zerolog.Logger {
	return Root.With().Str("source", source).Logger()
}
