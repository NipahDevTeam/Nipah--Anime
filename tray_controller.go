package main

import "sync"

type trayLifecycle interface {
	start()
	stop()
}

type trayControllerDeps struct {
	restore func() error
	quit    func() error
}

type trayBackend interface {
	start(*trayController)
	stop()
}

type trayController struct {
	deps    trayControllerDeps
	backend trayBackend
	once    sync.Once
}

func newTrayController(deps trayControllerDeps) *trayController {
	return &trayController{
		deps:    deps,
		backend: newTrayBackend(),
	}
}

func (t *trayController) handleRestore() error {
	if t.deps.restore == nil {
		return nil
	}
	return t.deps.restore()
}

func (t *trayController) handleQuit() error {
	if t.deps.quit == nil {
		return nil
	}
	return t.deps.quit()
}

func (t *trayController) start() {
	t.once.Do(func() {
		if t.backend != nil {
			t.backend.start(t)
		}
	})
}

func (t *trayController) stop() {
	if t.backend != nil {
		t.backend.stop()
	}
}
