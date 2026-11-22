//go:build !windows

package main

import (
	"errors"
	"os"
	"syscall"
)

func openRegularFile(path string) (*os.File, os.FileInfo, error) {
	// Open with O_NONBLOCK so a named pipe (FIFO) never blocks even if swapped in after any stat check.
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, nil, errors.New("Cannot read the saved file. Check its path and use /reload.")
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, nil, errors.New("The saved file must be a regular file.")
	}
	return f, info, nil
}
