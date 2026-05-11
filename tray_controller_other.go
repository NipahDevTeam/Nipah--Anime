//go:build !windows

package main

type noopTrayBackend struct{}

func newTrayBackend() trayBackend {
	return noopTrayBackend{}
}

func (noopTrayBackend) start(*trayController) {}

func (noopTrayBackend) stop() {}
