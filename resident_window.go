package main

import (
	"context"
	"fmt"
	"time"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	appLaunchWidth             = 960
	appLaunchHeight            = 620
	startupRestoreWidth        = 1400
	startupRestoreHeight       = 900
	residentWindowRestoreDelay = 160 * time.Millisecond
)

type residentWindowState struct {
	width         int
	height        int
	x             int
	y             int
	hasBounds     bool
	wasFullscreen bool
	wasMaximised  bool
}

var (
	runtimeWindowHide = runtime.WindowHide
	runtimeWindowShow = runtime.WindowShow

	runtimeWindowUnminimise = runtime.WindowUnminimise
	runtimeWindowMaximise   = runtime.WindowMaximise
	runtimeWindowUnmaximise = runtime.WindowUnmaximise
	runtimeWindowFullscreen = runtime.WindowFullscreen

	runtimeWindowSetSize     = runtime.WindowSetSize
	runtimeWindowSetPosition = runtime.WindowSetPosition

	runtimeWindowGetSize          = runtime.WindowGetSize
	runtimeWindowGetPosition      = runtime.WindowGetPosition
	runtimeWindowIsFullscreen     = runtime.WindowIsFullscreen
	runtimeWindowIsMaximised      = runtime.WindowIsMaximised
	runtimeQuit                   = runtime.Quit
	scheduleResidentWindowRestore = func(delay time.Duration, fn func()) {
		time.AfterFunc(delay, fn)
	}

	newAppTrayController = func(app *App) trayLifecycle {
		return newTrayController(trayControllerDeps{
			restore: func() error {
				return app.RestoreResidentWindow(options.SecondInstanceData{})
			},
			quit: app.QuitApp,
		})
	}
	startupApp = func(app *App, ctx context.Context) {
		app.startup(ctx)
	}
	shutdownApp = func(app *App, ctx context.Context) {
		app.shutdown(ctx)
	}
)

func newWailsAppOptions(app *App, processStarted time.Time) *options.App {
	tray := newAppTrayController(app)

	return &options.App{
		Title:     "Nipah! Anime",
		Width:     appLaunchWidth,
		Height:    appLaunchHeight,
		MinWidth:  920,
		MinHeight: 560,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour:  &options.RGBA{R: 10, G: 10, B: 14, A: 1},
		HideWindowOnClose: true,
		OnStartup: func(ctx context.Context) {
			installerLog.Info().Dur("since_process_start", time.Since(processStarted)).Msg("wails startup callback")
			startupApp(app, ctx)
			tray.start()
		},
		OnDomReady: func(ctx context.Context) {
			installerLog.Info().Dur("since_process_start", time.Since(processStarted)).Msg("wails dom ready callback")
			app.domReady(ctx)
		},
		OnBeforeClose: func(ctx context.Context) bool {
			return app.preventShutdownUnlessQuitRequested(ctx)
		},
		OnShutdown: func(ctx context.Context) {
			tray.stop()
			shutdownApp(app, ctx)
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "nipah-anime-resident-window",
			OnSecondInstanceLaunch: func(secondInstanceData options.SecondInstanceData) {
				if err := app.RestoreResidentWindow(secondInstanceData); err != nil {
					log.Warn().Err(err).Msg("failed to restore resident window from second launch")
				}
			},
		},
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent:              false,
			WindowIsTranslucent:               false,
			DisableWindowIcon:                 false,
			DisableFramelessWindowDecorations: false,
			WebviewUserDataPath:               "",
		},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarHiddenInset(),
			Appearance:           mac.DefaultAppearance,
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
			About: &mac.AboutInfo{
				Title:   "Nipah! Anime",
				Message: "A self-hosted anime & manga media server for Latin America.",
			},
		},
		Linux: &linux.Options{
			WindowIsTranslucent: false,
			WebviewGpuPolicy:    linux.WebviewGpuPolicyAlways,
		},
	}
}

func (a *App) preventShutdownUnlessQuitRequested(ctx context.Context) bool {
	windowCtx := a.windowContext(ctx)
	if windowCtx == nil {
		return false
	}

	a.residentWindowMu.Lock()
	if a.quitRequested {
		a.quitRequested = false
		a.residentWindowMu.Unlock()
		return false
	}

	width, height := runtimeWindowGetSize(windowCtx)
	x, y := runtimeWindowGetPosition(windowCtx)
	isFullscreen := runtimeWindowIsFullscreen(windowCtx)
	isMaximised := runtimeWindowIsMaximised(windowCtx)
	wasMaximised := isMaximised
	wasFullscreen := isFullscreen
	if residentWindowLooksResetToBootstrapBounds(width, height) {
		if a.residentWindowState.wasFullscreen {
			wasFullscreen = true
		}
		if a.residentWindowState.wasMaximised {
			wasMaximised = true
		}
		if !a.residentWindowState.hasBounds && !wasFullscreen {
			wasMaximised = true
		}
	}
	if !wasMaximised &&
		a.residentWindowState.wasMaximised &&
		width == startupRestoreWidth &&
		height == startupRestoreHeight {
		wasMaximised = true
	}

	a.residentWindowState = residentWindowState{
		width:         width,
		height:        height,
		x:             x,
		y:             y,
		hasBounds:     width > 0 && height > 0,
		wasFullscreen: wasFullscreen,
		wasMaximised:  wasMaximised,
	}
	a.residentWindowMu.Unlock()

	runtimeWindowHide(windowCtx)
	return true
}

func (a *App) RestoreResidentWindow(_ options.SecondInstanceData) error {
	windowCtx := a.windowContext(nil)
	if windowCtx == nil {
		return fmt.Errorf("window context not ready")
	}

	runtimeWindowShow(windowCtx)
	runtimeWindowUnminimise(windowCtx)

	a.residentWindowMu.Lock()
	state := a.residentWindowState
	a.residentWindowMu.Unlock()

	if runtimeWindowIsFullscreen(windowCtx) {
		return nil
	}
	if state.wasFullscreen {
		scheduleResidentWindowRestore(residentWindowRestoreDelay, func() {
			runtimeWindowFullscreen(windowCtx)
		})
		return nil
	}
	if runtimeWindowIsMaximised(windowCtx) {
		return nil
	}
	if state.wasMaximised {
		scheduleResidentWindowRestore(residentWindowRestoreDelay, func() {
			runtimeWindowMaximise(windowCtx)
		})
		return nil
	}
	if !state.hasBounds {
		return nil
	}

	scheduleResidentWindowRestore(residentWindowRestoreDelay, func() {
		runtimeWindowUnmaximise(windowCtx)
		runtimeWindowSetSize(windowCtx, state.width, state.height)
		runtimeWindowSetPosition(windowCtx, state.x, state.y)
	})
	return nil
}

func (a *App) QuitApp() error {
	windowCtx := a.windowContext(nil)
	if windowCtx == nil {
		return fmt.Errorf("window context not ready")
	}

	a.residentWindowMu.Lock()
	a.quitRequested = true
	a.residentWindowMu.Unlock()

	runtimeQuit(windowCtx)
	return nil
}

func (a *App) windowContext(fallback context.Context) context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return fallback
}

func residentWindowLooksResetToBootstrapBounds(width, height int) bool {
	return (width == appLaunchWidth && height == appLaunchHeight) ||
		(width == startupRestoreWidth && height == startupRestoreHeight)
}
