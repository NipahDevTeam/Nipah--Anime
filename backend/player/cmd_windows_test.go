//go:build windows

package player

import (
	"os/exec"
	"syscall"
	"testing"
)

const (
	createNewConsole = 0x00000010
	createNoWindow   = 0x08000000
)

func TestApplyPlatformCmdOptionsDoesNotRequestVisibleConsole(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "exit", "0")

	applyPlatformCmdOptions(cmd)

	if cmd.SysProcAttr == nil {
		t.Fatal("expected Windows process attributes to be configured")
	}
	if cmd.SysProcAttr.CreationFlags&createNewConsole != 0 {
		t.Fatal("expected player launch to avoid CREATE_NEW_CONSOLE")
	}
	if cmd.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatal("expected player launch to suppress the extra console window")
	}
	if cmd.SysProcAttr.HideWindow {
		t.Fatal("expected player launch to preserve normal window behavior for the actual player UI")
	}
}

var _ syscall.SysProcAttr
