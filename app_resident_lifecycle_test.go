package main

import (
	"context"
	"testing"
	"time"

	"github.com/wailsapp/wails/v2/pkg/options"
)

func TestResidentWindowOptionsEnableHideAndSingleInstance(t *testing.T) {
	processStarted := time.Unix(1, 0)
	app := NewApp()

	opts := newWailsAppOptions(app, processStarted)

	if !opts.Frameless {
		t.Fatalf("expected frameless window mode to be enabled for the native shell")
	}
	if opts.CSSDragProperty != "--wails-draggable" {
		t.Fatalf("expected custom drag property to use the wails draggable token, got %q", opts.CSSDragProperty)
	}
	if opts.CSSDragValue != "drag" {
		t.Fatalf("expected custom drag value to use the drag token, got %q", opts.CSSDragValue)
	}
	if !opts.HideWindowOnClose {
		t.Fatalf("expected HideWindowOnClose to be enabled")
	}
	if opts.OnBeforeClose == nil {
		t.Fatalf("expected OnBeforeClose hook to be configured")
	}
	if opts.SingleInstanceLock == nil {
		t.Fatalf("expected SingleInstanceLock to be configured")
	}
	if opts.SingleInstanceLock.UniqueId == "" {
		t.Fatalf("expected SingleInstanceLock to have a stable unique id")
	}
	if opts.BackgroundColour == nil || opts.BackgroundColour.A != 255 {
		t.Fatalf("expected native shell background colour to stay fully opaque")
	}
	if opts.Windows == nil {
		t.Fatalf("expected windows options to be configured")
	}
	if opts.Windows.DisableFramelessWindowDecorations {
		t.Fatalf("expected frameless window decorations to stay enabled for shadow and snap support")
	}
}

func TestPreventShutdownUnlessQuitRequestedHidesWindow(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()

	originalHide := runtimeWindowHide
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalIsMaximised := runtimeWindowIsMaximised
	originalGetSize := runtimeWindowGetSize
	originalGetPosition := runtimeWindowGetPosition
	t.Cleanup(func() {
		runtimeWindowHide = originalHide
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowIsMaximised = originalIsMaximised
		runtimeWindowGetSize = originalGetSize
		runtimeWindowGetPosition = originalGetPosition
	})

	hideCalls := 0
	runtimeWindowHide = func(ctx context.Context) {
		hideCalls++
	}
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	runtimeWindowGetSize = func(context.Context) (int, int) { return 1200, 800 }
	runtimeWindowGetPosition = func(context.Context) (int, int) { return 40, 40 }

	prevent := app.preventShutdownUnlessQuitRequested(context.Background())
	if !prevent {
		t.Fatalf("expected normal close to be prevented")
	}
	if hideCalls != 1 {
		t.Fatalf("expected window hide to be requested once, got %d", hideCalls)
	}
}

func TestPreventShutdownUnlessQuitRequestedRemembersMaximisedState(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()

	originalHide := runtimeWindowHide
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalIsMaximised := runtimeWindowIsMaximised
	originalGetSize := runtimeWindowGetSize
	originalGetPosition := runtimeWindowGetPosition
	t.Cleanup(func() {
		runtimeWindowHide = originalHide
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowIsMaximised = originalIsMaximised
		runtimeWindowGetSize = originalGetSize
		runtimeWindowGetPosition = originalGetPosition
	})

	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return true }
	runtimeWindowHide = func(context.Context) {}
	runtimeWindowGetSize = func(context.Context) (int, int) { return 1600, 900 }
	runtimeWindowGetPosition = func(context.Context) (int, int) { return 100, 80 }

	if prevent := app.preventShutdownUnlessQuitRequested(context.Background()); !prevent {
		t.Fatalf("expected close to be intercepted")
	}
	if !app.residentWindowState.wasMaximised {
		t.Fatalf("expected maximised state to be remembered")
	}
}

func TestPreventShutdownUnlessQuitRequestedPreservesMaximisePreferenceForStartupRestoreBounds(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()
	app.residentWindowState.wasMaximised = true

	originalHide := runtimeWindowHide
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalIsMaximised := runtimeWindowIsMaximised
	originalGetSize := runtimeWindowGetSize
	originalGetPosition := runtimeWindowGetPosition
	t.Cleanup(func() {
		runtimeWindowHide = originalHide
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowIsMaximised = originalIsMaximised
		runtimeWindowGetSize = originalGetSize
		runtimeWindowGetPosition = originalGetPosition
	})

	runtimeWindowHide = func(context.Context) {}
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	runtimeWindowGetSize = func(context.Context) (int, int) { return startupRestoreWidth, startupRestoreHeight }
	runtimeWindowGetPosition = func(context.Context) (int, int) { return 100, 80 }

	if prevent := app.preventShutdownUnlessQuitRequested(context.Background()); !prevent {
		t.Fatalf("expected close to be intercepted")
	}
	if !app.residentWindowState.wasMaximised {
		t.Fatalf("expected maximise preference to survive startup restore bounds false negative")
	}
}

func TestPreventShutdownUnlessQuitRequestedPrefersExpandedRestoreForBootstrapBounds(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()

	originalHide := runtimeWindowHide
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalIsMaximised := runtimeWindowIsMaximised
	originalGetSize := runtimeWindowGetSize
	originalGetPosition := runtimeWindowGetPosition
	t.Cleanup(func() {
		runtimeWindowHide = originalHide
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowIsMaximised = originalIsMaximised
		runtimeWindowGetSize = originalGetSize
		runtimeWindowGetPosition = originalGetPosition
	})

	runtimeWindowHide = func(context.Context) {}
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	runtimeWindowGetSize = func(context.Context) (int, int) { return appLaunchWidth, appLaunchHeight }
	runtimeWindowGetPosition = func(context.Context) (int, int) { return 100, 80 }

	if prevent := app.preventShutdownUnlessQuitRequested(context.Background()); !prevent {
		t.Fatalf("expected close to be intercepted")
	}
	if !app.residentWindowState.wasMaximised {
		t.Fatalf("expected bootstrap-sized false negative to prefer expanded restore")
	}
}

func TestQuitAppAllowsNextShutdownAttempt(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()

	originalQuit := runtimeQuit
	originalHide := runtimeWindowHide
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalIsMaximised := runtimeWindowIsMaximised
	originalGetSize := runtimeWindowGetSize
	originalGetPosition := runtimeWindowGetPosition
	t.Cleanup(func() {
		runtimeQuit = originalQuit
		runtimeWindowHide = originalHide
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowIsMaximised = originalIsMaximised
		runtimeWindowGetSize = originalGetSize
		runtimeWindowGetPosition = originalGetPosition
	})

	quitCalls := 0
	runtimeQuit = func(ctx context.Context) {
		quitCalls++
	}
	runtimeWindowHide = func(ctx context.Context) {}
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	runtimeWindowGetSize = func(context.Context) (int, int) { return 1400, 900 }
	runtimeWindowGetPosition = func(context.Context) (int, int) { return 60, 60 }

	if err := app.QuitApp(); err != nil {
		t.Fatalf("QuitApp returned error: %v", err)
	}
	if quitCalls != 1 {
		t.Fatalf("expected runtime quit to be called once, got %d", quitCalls)
	}

	if prevent := app.preventShutdownUnlessQuitRequested(context.Background()); prevent {
		t.Fatalf("expected explicit quit request to allow shutdown")
	}

	if prevent := app.preventShutdownUnlessQuitRequested(context.Background()); !prevent {
		t.Fatalf("expected explicit quit flag to reset after allowing shutdown")
	}
}

func TestRestoreResidentWindowShowsExistingInstance(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()

	originalShow := runtimeWindowShow
	originalUnminimise := runtimeWindowUnminimise
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalMaximise := runtimeWindowMaximise
	originalIsMaximised := runtimeWindowIsMaximised
	originalSchedule := scheduleResidentWindowRestore
	t.Cleanup(func() {
		runtimeWindowShow = originalShow
		runtimeWindowUnminimise = originalUnminimise
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowMaximise = originalMaximise
		runtimeWindowIsMaximised = originalIsMaximised
		scheduleResidentWindowRestore = originalSchedule
	})

	var calls []string
	runtimeWindowShow = func(ctx context.Context) {
		calls = append(calls, "show")
	}
	runtimeWindowUnminimise = func(ctx context.Context) {
		calls = append(calls, "unminimise")
	}
	runtimeWindowMaximise = func(ctx context.Context) {
		calls = append(calls, "maximise")
	}
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	scheduleResidentWindowRestore = func(_ time.Duration, fn func()) {
		calls = append(calls, "scheduled")
		fn()
	}

	if err := app.RestoreResidentWindow(options.SecondInstanceData{}); err != nil {
		t.Fatalf("RestoreResidentWindow returned error: %v", err)
	}

	if len(calls) != 4 || calls[0] != "show" || calls[1] != "unminimise" || calls[2] != "scheduled" || calls[3] != "maximise" {
		t.Fatalf("expected show/unminimise restore sequence to schedule maximise, got %#v", calls)
	}
}

func TestRestoreResidentWindowAlwaysSchedulesMaximiseWhenNotFullscreen(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()
	app.residentWindowState = residentWindowState{
		width:     1440,
		height:    920,
		x:         120,
		y:         90,
		hasBounds: true,
	}

	originalShow := runtimeWindowShow
	originalUnminimise := runtimeWindowUnminimise
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalIsMaximised := runtimeWindowIsMaximised
	originalMaximise := runtimeWindowMaximise
	originalSchedule := scheduleResidentWindowRestore
	t.Cleanup(func() {
		runtimeWindowShow = originalShow
		runtimeWindowUnminimise = originalUnminimise
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowIsMaximised = originalIsMaximised
		runtimeWindowMaximise = originalMaximise
		scheduleResidentWindowRestore = originalSchedule
	})

	var calls []string
	var scheduledDelay time.Duration
	runtimeWindowShow = func(context.Context) { calls = append(calls, "show") }
	runtimeWindowUnminimise = func(context.Context) { calls = append(calls, "unminimise") }
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	runtimeWindowMaximise = func(context.Context) { calls = append(calls, "maximise") }
	scheduleResidentWindowRestore = func(delay time.Duration, fn func()) {
		scheduledDelay = delay
		calls = append(calls, "scheduled")
		fn()
	}

	if err := app.RestoreResidentWindow(options.SecondInstanceData{}); err != nil {
		t.Fatalf("RestoreResidentWindow returned error: %v", err)
	}

	if scheduledDelay != residentWindowRestoreDelay {
		t.Fatalf("expected maximise restore delay %v, got %v", residentWindowRestoreDelay, scheduledDelay)
	}
	if len(calls) != 4 || calls[0] != "show" || calls[1] != "unminimise" || calls[2] != "scheduled" || calls[3] != "maximise" {
		t.Fatalf("expected tray restore to schedule maximise after show/unminimise, got %#v", calls)
	}
}

func TestRestoreResidentWindowReappliesMaximiseWhenNeeded(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()
	app.residentWindowState.wasMaximised = true

	originalShow := runtimeWindowShow
	originalUnminimise := runtimeWindowUnminimise
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalMaximise := runtimeWindowMaximise
	originalIsMaximised := runtimeWindowIsMaximised
	originalSchedule := scheduleResidentWindowRestore
	t.Cleanup(func() {
		runtimeWindowShow = originalShow
		runtimeWindowUnminimise = originalUnminimise
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowMaximise = originalMaximise
		runtimeWindowIsMaximised = originalIsMaximised
		scheduleResidentWindowRestore = originalSchedule
	})

	var calls []string
	runtimeWindowShow = func(context.Context) {
		calls = append(calls, "show")
	}
	runtimeWindowUnminimise = func(context.Context) {
		calls = append(calls, "unminimise")
	}
	runtimeWindowMaximise = func(context.Context) {
		calls = append(calls, "maximise")
	}
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	scheduleResidentWindowRestore = func(_ time.Duration, fn func()) { fn() }

	if err := app.RestoreResidentWindow(options.SecondInstanceData{}); err != nil {
		t.Fatalf("RestoreResidentWindow returned error: %v", err)
	}
	if len(calls) != 3 || calls[2] != "maximise" {
		t.Fatalf("expected maximise to be restored, got %#v", calls)
	}
}

func TestRestoreResidentWindowSchedulesMaximiseAfterReveal(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()
	app.residentWindowState.wasMaximised = true

	originalShow := runtimeWindowShow
	originalUnminimise := runtimeWindowUnminimise
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalMaximise := runtimeWindowMaximise
	originalIsMaximised := runtimeWindowIsMaximised
	originalSchedule := scheduleResidentWindowRestore
	t.Cleanup(func() {
		runtimeWindowShow = originalShow
		runtimeWindowUnminimise = originalUnminimise
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowMaximise = originalMaximise
		runtimeWindowIsMaximised = originalIsMaximised
		scheduleResidentWindowRestore = originalSchedule
	})

	var calls []string
	var scheduledDelay time.Duration
	runtimeWindowShow = func(context.Context) {
		calls = append(calls, "show")
	}
	runtimeWindowUnminimise = func(context.Context) {
		calls = append(calls, "unminimise")
	}
	runtimeWindowMaximise = func(context.Context) {
		calls = append(calls, "maximise")
	}
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	scheduleResidentWindowRestore = func(delay time.Duration, fn func()) {
		scheduledDelay = delay
		calls = append(calls, "scheduled")
		fn()
	}

	if err := app.RestoreResidentWindow(options.SecondInstanceData{}); err != nil {
		t.Fatalf("RestoreResidentWindow returned error: %v", err)
	}
	if scheduledDelay != residentWindowRestoreDelay {
		t.Fatalf("expected maximise restore delay %v, got %v", residentWindowRestoreDelay, scheduledDelay)
	}
	if len(calls) != 4 || calls[0] != "show" || calls[1] != "unminimise" || calls[2] != "scheduled" || calls[3] != "maximise" {
		t.Fatalf("expected maximise to be scheduled after reveal, got %#v", calls)
	}
}

func TestRestoreResidentWindowReappliesFullscreenWhenNeeded(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()
	app.residentWindowState.wasFullscreen = true

	originalShow := runtimeWindowShow
	originalUnminimise := runtimeWindowUnminimise
	originalFullscreen := runtimeWindowFullscreen
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalIsMaximised := runtimeWindowIsMaximised
	originalSchedule := scheduleResidentWindowRestore
	t.Cleanup(func() {
		runtimeWindowShow = originalShow
		runtimeWindowUnminimise = originalUnminimise
		runtimeWindowFullscreen = originalFullscreen
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowIsMaximised = originalIsMaximised
		scheduleResidentWindowRestore = originalSchedule
	})

	var calls []string
	runtimeWindowShow = func(context.Context) {
		calls = append(calls, "show")
	}
	runtimeWindowUnminimise = func(context.Context) {
		calls = append(calls, "unminimise")
	}
	runtimeWindowFullscreen = func(context.Context) {
		calls = append(calls, "fullscreen")
	}
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	scheduleResidentWindowRestore = func(_ time.Duration, fn func()) { fn() }

	if err := app.RestoreResidentWindow(options.SecondInstanceData{}); err != nil {
		t.Fatalf("RestoreResidentWindow returned error: %v", err)
	}
	if len(calls) != 3 || calls[2] != "fullscreen" {
		t.Fatalf("expected fullscreen to be restored, got %#v", calls)
	}
}

func TestRestoreResidentWindowIsIdempotent(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()

	originalShow := runtimeWindowShow
	originalUnminimise := runtimeWindowUnminimise
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalIsMaximised := runtimeWindowIsMaximised
	originalSchedule := scheduleResidentWindowRestore
	t.Cleanup(func() {
		runtimeWindowShow = originalShow
		runtimeWindowUnminimise = originalUnminimise
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowIsMaximised = originalIsMaximised
		scheduleResidentWindowRestore = originalSchedule
	})

	showCalls := 0
	unminimiseCalls := 0
	runtimeWindowShow = func(context.Context) { showCalls++ }
	runtimeWindowUnminimise = func(context.Context) { unminimiseCalls++ }
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	scheduleResidentWindowRestore = func(time.Duration, func()) {}

	if err := app.RestoreResidentWindow(options.SecondInstanceData{}); err != nil {
		t.Fatalf("first restore failed: %v", err)
	}
	if err := app.RestoreResidentWindow(options.SecondInstanceData{}); err != nil {
		t.Fatalf("second restore failed: %v", err)
	}
	if showCalls != 2 || unminimiseCalls != 2 {
		t.Fatalf("expected repeatable restore calls, got show=%d unminimise=%d", showCalls, unminimiseCalls)
	}
}

func TestRestoreResidentWindowReappliesWindowBoundsWhenNotMaximised(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()
	app.residentWindowState = residentWindowState{
		width:     1440,
		height:    920,
		x:         120,
		y:         90,
		hasBounds: true,
	}

	originalShow := runtimeWindowShow
	originalUnminimise := runtimeWindowUnminimise
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalSetSize := runtimeWindowSetSize
	originalSetPosition := runtimeWindowSetPosition
	originalUnmaximise := runtimeWindowUnmaximise
	originalIsMaximised := runtimeWindowIsMaximised
	originalMaximise := runtimeWindowMaximise
	originalSchedule := scheduleResidentWindowRestore
	t.Cleanup(func() {
		runtimeWindowShow = originalShow
		runtimeWindowUnminimise = originalUnminimise
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowSetSize = originalSetSize
		runtimeWindowSetPosition = originalSetPosition
		runtimeWindowUnmaximise = originalUnmaximise
		runtimeWindowIsMaximised = originalIsMaximised
		runtimeWindowMaximise = originalMaximise
		scheduleResidentWindowRestore = originalSchedule
	})

	var calls []string
	runtimeWindowShow = func(context.Context) { calls = append(calls, "show") }
	runtimeWindowUnminimise = func(context.Context) { calls = append(calls, "unminimise") }
	runtimeWindowUnmaximise = func(context.Context) { calls = append(calls, "unmaximise") }
	runtimeWindowSetSize = func(context.Context, int, int) { calls = append(calls, "setsize") }
	runtimeWindowSetPosition = func(context.Context, int, int) { calls = append(calls, "setposition") }
	runtimeWindowMaximise = func(context.Context) { calls = append(calls, "maximise") }
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	scheduleResidentWindowRestore = func(_ time.Duration, fn func()) {
		calls = append(calls, "scheduled")
		fn()
	}

	if err := app.RestoreResidentWindow(options.SecondInstanceData{}); err != nil {
		t.Fatalf("RestoreResidentWindow returned error: %v", err)
	}

	if len(calls) != 4 || calls[0] != "show" || calls[1] != "unminimise" || calls[2] != "scheduled" || calls[3] != "maximise" {
		t.Fatalf("expected tray restore to prefer scheduled maximise over restoring manual bounds, got %#v", calls)
	}
}

func TestPreventShutdownUnlessQuitRequestedRemembersMaximisedWindowState(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()

	originalHide := runtimeWindowHide
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalIsMaximised := runtimeWindowIsMaximised
	originalGetSize := runtimeWindowGetSize
	originalGetPosition := runtimeWindowGetPosition
	t.Cleanup(func() {
		runtimeWindowHide = originalHide
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowIsMaximised = originalIsMaximised
		runtimeWindowGetSize = originalGetSize
		runtimeWindowGetPosition = originalGetPosition
	})

	hideCalls := 0
	runtimeWindowHide = func(ctx context.Context) {
		hideCalls++
	}
	runtimeWindowIsFullscreen = func(ctx context.Context) bool { return false }
	runtimeWindowIsMaximised = func(ctx context.Context) bool {
		return true
	}
	runtimeWindowGetSize = func(context.Context) (int, int) { return 1600, 900 }
	runtimeWindowGetPosition = func(context.Context) (int, int) { return 100, 80 }

	prevent := app.preventShutdownUnlessQuitRequested(context.Background())
	if !prevent {
		t.Fatalf("expected close to be prevented")
	}
	if hideCalls != 1 {
		t.Fatalf("expected hide to be requested once, got %d", hideCalls)
	}
	if !app.residentWindowState.wasMaximised {
		t.Fatalf("expected resident window state to remember maximised presentation")
	}
	if !app.residentWindowState.hasBounds {
		t.Fatalf("expected resident window state to remember window bounds")
	}
}

func TestRestoreResidentWindowLeavesNaturallyMaximisedWindowAlone(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()
	app.residentWindowState = residentWindowState{
		width:     1440,
		height:    920,
		x:         120,
		y:         90,
		hasBounds: true,
	}

	originalShow := runtimeWindowShow
	originalUnminimise := runtimeWindowUnminimise
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalSetSize := runtimeWindowSetSize
	originalSetPosition := runtimeWindowSetPosition
	originalUnmaximise := runtimeWindowUnmaximise
	originalIsMaximised := runtimeWindowIsMaximised
	originalSchedule := scheduleResidentWindowRestore
	t.Cleanup(func() {
		runtimeWindowShow = originalShow
		runtimeWindowUnminimise = originalUnminimise
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowSetSize = originalSetSize
		runtimeWindowSetPosition = originalSetPosition
		runtimeWindowUnmaximise = originalUnmaximise
		runtimeWindowIsMaximised = originalIsMaximised
		scheduleResidentWindowRestore = originalSchedule
	})

	var calls []string
	runtimeWindowShow = func(context.Context) { calls = append(calls, "show") }
	runtimeWindowUnminimise = func(context.Context) { calls = append(calls, "unminimise") }
	runtimeWindowSetSize = func(context.Context, int, int) { calls = append(calls, "setsize") }
	runtimeWindowSetPosition = func(context.Context, int, int) { calls = append(calls, "setposition") }
	runtimeWindowUnmaximise = func(context.Context) { calls = append(calls, "unmaximise") }
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return true }
	scheduleResidentWindowRestore = func(time.Duration, func()) {}

	if err := app.RestoreResidentWindow(options.SecondInstanceData{}); err != nil {
		t.Fatalf("RestoreResidentWindow returned error: %v", err)
	}

	if len(calls) != 2 || calls[0] != "show" || calls[1] != "unminimise" {
		t.Fatalf("expected only show/unminimise when window already restored maximised, got %#v", calls)
	}
}

func TestRestoreResidentWindowReappliesMaximiseWhenPreviouslyMaximised(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()
	app.residentWindowState.wasMaximised = true

	originalShow := runtimeWindowShow
	originalUnminimise := runtimeWindowUnminimise
	originalIsFullscreen := runtimeWindowIsFullscreen
	originalMaximise := runtimeWindowMaximise
	originalIsMaximised := runtimeWindowIsMaximised
	originalSchedule := scheduleResidentWindowRestore
	t.Cleanup(func() {
		runtimeWindowShow = originalShow
		runtimeWindowUnminimise = originalUnminimise
		runtimeWindowIsFullscreen = originalIsFullscreen
		runtimeWindowMaximise = originalMaximise
		runtimeWindowIsMaximised = originalIsMaximised
		scheduleResidentWindowRestore = originalSchedule
	})

	var calls []string
	runtimeWindowShow = func(ctx context.Context) {
		calls = append(calls, "show")
	}
	runtimeWindowUnminimise = func(ctx context.Context) {
		calls = append(calls, "unminimise")
	}
	runtimeWindowMaximise = func(ctx context.Context) {
		calls = append(calls, "maximise")
	}
	runtimeWindowIsFullscreen = func(context.Context) bool { return false }
	runtimeWindowIsMaximised = func(context.Context) bool { return false }
	scheduleResidentWindowRestore = func(_ time.Duration, fn func()) { fn() }

	if err := app.RestoreResidentWindow(options.SecondInstanceData{}); err != nil {
		t.Fatalf("RestoreResidentWindow returned error: %v", err)
	}

	if len(calls) != 3 || calls[0] != "show" || calls[1] != "unminimise" || calls[2] != "maximise" {
		t.Fatalf("expected show/unminimise/maximise restore sequence, got %#v", calls)
	}
}
