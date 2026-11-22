package main

import "strings"

// These variables can be overridden at build time via -ldflags:
//   -X main.AppVersion=0.1.42
//   -X main.GitCommit=abc1234
//   -X main.UpdateRepo=ericwooley/simple-guild-site
var (
	AppVersion = "0.1.0-dev"
	GitCommit  = "dev"
	UpdateRepo = "ericwooley/simple-guild-site"
)

func effectiveUpdateRepo() string {
	repo := strings.TrimSpace(UpdateRepo)
	if repo == "" {
		return "ericwooley/simple-guild-site"
	}
	return repo
}
