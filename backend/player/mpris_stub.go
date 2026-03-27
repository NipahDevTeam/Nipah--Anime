//go:build !linux

package player

func newMPRISBridge(m *Manager) mprisBridge { return nil }
