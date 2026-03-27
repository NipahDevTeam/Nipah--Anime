//go:build !windows

package player

import "os/exec"

func applyPlatformCmdOptions(cmd *exec.Cmd) {}
