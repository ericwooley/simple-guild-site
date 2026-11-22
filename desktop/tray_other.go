//go:build !darwin

package main

func setupTray(_ *App) {}

func updateTrayWatchState(_ bool) {}

func updateTrayUpdateState(_ bool, _ string) {}
