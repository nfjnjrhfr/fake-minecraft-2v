// Package logx is a tiny levelled logger. It exists so that the proxy can be
// quiet by default: connection-level logs on a censorship-resistant proxy are
// a record of exactly which sites a user visited, and the safest place for
// that record is nowhere.
package logx

import (
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"sync/atomic"
)

// Levels, ordered by increasing verbosity.
const (
	LevelError = iota
	LevelWarn
	LevelInfo
	LevelDebug
)

var (
	level  atomic.Int32
	logger = log.New(os.Stderr, "", log.LstdFlags)
)

func init() { level.Store(LevelInfo) }

// SetLevel parses and applies a level name. Unknown names fall back to info.
func SetLevel(name string) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "error":
		level.Store(LevelError)
	case "warn", "warning":
		level.Store(LevelWarn)
	case "debug":
		level.Store(LevelDebug)
	case "none", "off", "silent":
		level.Store(-1)
	default:
		level.Store(LevelInfo)
	}
}

// SetOutput redirects log output.
func SetOutput(w io.Writer) { logger.SetOutput(w) }

// Enabled reports whether messages at lvl would be written. Callers use it to
// skip building expensive messages.
func Enabled(lvl int) bool { return int(level.Load()) >= lvl }

func output(lvl int, prefix, format string, args ...any) {
	if int(level.Load()) < lvl {
		return
	}
	logger.Output(3, prefix+fmt.Sprintf(format, args...))
}

// Errorf logs at error level.
func Errorf(format string, args ...any) { output(LevelError, "[error] ", format, args...) }

// Warnf logs at warning level.
func Warnf(format string, args ...any) { output(LevelWarn, "[warn ] ", format, args...) }

// Infof logs at info level.
func Infof(format string, args ...any) { output(LevelInfo, "[info ] ", format, args...) }

// Debugf logs at debug level. Per-connection destinations are logged only
// here, never at info, so that a default deployment keeps no browsing history.
func Debugf(format string, args ...any) { output(LevelDebug, "[debug] ", format, args...) }
