//go:build windows

package player

import (
	"os/exec"
	"syscall"
)

func applyPlatformCmdOptions(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x00000010, // CREATE_NEW_CONSOLE
	}
}
