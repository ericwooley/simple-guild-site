//go:build windows

package main

import "os/exec"

func detachCmd(_ *exec.Cmd) {}
