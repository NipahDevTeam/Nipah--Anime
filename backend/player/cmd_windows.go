//go:build windows

package player

import (
	"os/exec"
	"syscall"
)

func applyPlatformCmdOptions(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW for mpv.exe's console subsystem wrapper
	}
}
