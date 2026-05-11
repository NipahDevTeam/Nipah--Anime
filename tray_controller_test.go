package main

import (
	"context"
	"testing"
	"time"
)

func TestTrayControllerRoutesRestoreAndQuitActions(t *testing.T) {
	restoreCalls := 0
	quitCalls := 0

	ctrl := newTrayController(trayControllerDeps{
		restore: func() error {
			restoreCalls++
			return nil
		},
		quit: func() error {
			quitCalls++
			return nil
		},
	})

	if err := ctrl.handleRestore(); err != nil {
		t.Fatalf("handleRestore returned error: %v", err)
	}
	if err := ctrl.handleQuit(); err != nil {
		t.Fatalf("handleQuit returned error: %v", err)
	}
	if restoreCalls != 1 || quitCalls != 1 {
		t.Fatalf("unexpected callback counts restore=%d quit=%d", restoreCalls, quitCalls)
	}
}

func TestWailsAppOptionsManageTrayLifecycle(t *testing.T) {
	originalFactory := newAppTrayController
	originalStartup := startupApp
	originalShutdown := shutdownApp
	t.Cleanup(func() {
		newAppTrayController = originalFactory
		startupApp = originalStartup
		shutdownApp = originalShutdown
	})

	tray := &stubTrayLifecycle{}
	newAppTrayController = func(*App) trayLifecycle {
		return tray
	}

	startupCalls := 0
	shutdownCalls := 0
	startupApp = func(app *App, ctx context.Context) {
		startupCalls++
	}
	shutdownApp = func(app *App, ctx context.Context) {
		shutdownCalls++
	}

	opts := newWailsAppOptions(NewApp(), time.Unix(1, 0))
	ctx := context.Background()

	if opts.OnStartup == nil {
		t.Fatalf("expected OnStartup hook to be configured")
	}
	if opts.OnShutdown == nil {
		t.Fatalf("expected OnShutdown hook to be configured")
	}

	opts.OnStartup(ctx)
	opts.OnShutdown(ctx)

	if startupCalls != 1 {
		t.Fatalf("expected startup to be called once, got %d", startupCalls)
	}
	if shutdownCalls != 1 {
		t.Fatalf("expected shutdown to be called once, got %d", shutdownCalls)
	}
	if tray.startCalls != 1 {
		t.Fatalf("expected tray start once, got %d", tray.startCalls)
	}
	if tray.stopCalls != 1 {
		t.Fatalf("expected tray stop once, got %d", tray.stopCalls)
	}
}

type stubTrayLifecycle struct {
	startCalls int
	stopCalls  int
}

func (s *stubTrayLifecycle) start() {
	s.startCalls++
}

func (s *stubTrayLifecycle) stop() {
	s.stopCalls++
}
