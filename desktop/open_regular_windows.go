//go:build windows

package main

import (
	"errors"
	"os"
)

func openRegularFile(path string) (*os.File, os.FileInfo, error) {
	preInfo, err := os.Stat(path)
	if err != nil {
		return nil, nil, errors.New("Cannot read the saved file. Check its path and use /reload.")
	}
	if !preInfo.Mode().IsRegular() {
		return nil, nil, errors.New("The saved file must be a regular file.")
	}
	f, err := os.Open(path)
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
