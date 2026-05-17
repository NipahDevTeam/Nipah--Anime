package main

import (
	"context"
	"testing"
)

func TestCompleteStartupLaunchSchedulesSafeMaximiseAfterReveal(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()

	originalSetDarkTheme := runtimeWindowSetDarkTheme
	originalSetMinSize := runtimeWindowSetMinSize
	originalShow := runtimeWindowShow
	originalUnminimise := runtimeWindowUnminimise
	originalSetSize := runtimeWindowSetSize
	originalCenter := runtimeWindowCenter
	originalMaximise := runtimeWindowMaximise
	originalGetSize := runtimeWindowGetSize
	originalSchedule := scheduleResidentWindowRestore
	t.Cleanup(func() {
		runtimeWindowSetDarkTheme = originalSetDarkTheme
		runtimeWindowSetMinSize = originalSetMinSize
		runtimeWindowShow = originalShow
		runtimeWindowUnminimise = originalUnminimise
		runtimeWindowSetSize = originalSetSize
		runtimeWindowCenter = originalCenter
		runtimeWindowMaximise = originalMaximise
		runtimeWindowGetSize = originalGetSize
		scheduleResidentWindowRestore = originalSchedule
	})

	maximiseCalls := 0
	sizeCalls := 0
	centerCalls := 0
	showCalls := 0
	unminimiseCalls := 0
	scheduledCalls := 0

	runtimeWindowSetDarkTheme = func(context.Context) {}
	runtimeWindowSetMinSize = func(context.Context, int, int) {}
	runtimeWindowShow = func(context.Context) { showCalls++ }
	runtimeWindowUnminimise = func(context.Context) { unminimiseCalls++ }
	runtimeWindowSetSize = func(context.Context, int, int) { sizeCalls++ }
	runtimeWindowCenter = func(context.Context) { centerCalls++ }
	runtimeWindowMaximise = func(context.Context) { maximiseCalls++ }
	runtimeWindowGetSize = func(context.Context) (int, int) { return appLaunchWidth, appLaunchHeight }
	scheduleResidentWindowRestore = func(_ time.Duration, fn func()) {
		scheduledCalls++
		fn()
	}

	if err := app.CompleteStartupLaunch(); err != nil {
		t.Fatalf("CompleteStartupLaunch returned error: %v", err)
	}

	if maximiseCalls != 1 {
		t.Fatalf("expected startup launch to re-enter maximised after reveal, got %d maximise call(s)", maximiseCalls)
	}
	if sizeCalls != 1 {
		t.Fatalf("expected startup launch to expand bootstrap bounds exactly once, got %d size call(s)", sizeCalls)
	}
	if centerCalls != 1 {
		t.Fatalf("expected startup launch to recenter only when expanding bootstrap bounds, got %d center call(s)", centerCalls)
	}
	if scheduledCalls != 1 {
		t.Fatalf("expected startup launch to schedule maximise once instead of forcing it inline, got %d scheduled call(s)", scheduledCalls)
	}
	if showCalls == 0 || unminimiseCalls == 0 {
		t.Fatalf("expected startup launch to keep the window visible and restorable during reveal, got show=%d unminimise=%d", showCalls, unminimiseCalls)
	}
}
