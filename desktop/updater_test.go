package main

import (
	"strings"
	"testing"
)

func TestIsNewerVersion(t *testing.T) {
	cases := []struct {
		current   string
		candidate string
		want      bool
	}{
		{"0.1.0-dev", "desktop-v0.1.0", true},
		{"0.1.0-dev", "desktop-v0.1.12", true},
		{"0.1.12", "desktop-v0.1.12", false},
		{"0.1.12", "desktop-v0.1.13", true},
		{"0.1.13", "desktop-v0.1.12", false},
		{"0.1.99", "v0.2.0", true},
		{"1.0.0", "desktop-v0.9.99", false},
		{"0.1.5", "invalid", false},
	}
	for _, tc := range cases {
		got := isNewerVersion(tc.current, tc.candidate)
		if got != tc.want {
			t.Errorf("isNewerVersion(%q, %q) = %v, want %v", tc.current, tc.candidate, got, tc.want)
		}
	}
}

func TestSelectMacOSDMGAsset(t *testing.T) {
	assets := []githubReleaseAsset{
		{Name: "HelpingHand-macOS-universal.dmg", BrowserDownloadURL: "https://github.com/ericwooley/simple-guild-site/releases/download/desktop-v0.1.2/HelpingHand-macOS-universal.dmg"},
		{Name: "SHA256SUMS.txt", BrowserDownloadURL: "https://github.com/ericwooley/simple-guild-site/releases/download/desktop-v0.1.2/SHA256SUMS.txt"},
	}
	dmg, sum := selectMacOSDMGAsset(assets, "arm64")
	if dmg == nil || dmg.Name != "HelpingHand-macOS-universal.dmg" {
		t.Fatalf("expected universal DMG, got %+v", dmg)
	}
	if sum == nil || sum.Name != "SHA256SUMS.txt" {
		t.Fatalf("expected SHA256SUMS.txt, got %+v", sum)
	}
}

func TestParseChecksumForFile(t *testing.T) {
	hash := strings.Repeat("a", 64)
	content := hash + "  HelpingHand-macOS-universal.dmg\n"
	if got := parseChecksumForFile(content, "HelpingHand-macOS-universal.dmg"); got != hash {
		t.Fatalf("got %q, want %q", got, hash)
	}
	if got := parseChecksumForFile(content, "other.dmg"); got != "" {
		t.Fatalf("expected empty checksum for unknown file, got %q", got)
	}
}

func TestIsTrustedReleaseAssetURL(t *testing.T) {
	if !isTrustedReleaseAssetURL("https://github.com/ericwooley/simple-guild-site/releases/download/desktop-v0.1.1/HelpingHand-macOS-universal.dmg") {
		t.Fatal("expected github.com release URL to be trusted")
	}
	if !isTrustedReleaseAssetURL("https://objects.githubusercontent.com/github-production-release-asset/123") {
		t.Fatal("expected objects.githubusercontent.com to be trusted")
	}
	if isTrustedReleaseAssetURL("http://github.com/ericwooley/simple-guild-site/releases/download/v1/a.dmg") {
		t.Fatal("expected http URL to be rejected")
	}
	if isTrustedReleaseAssetURL("https://evil.example.com/HelpingHand.dmg") {
		t.Fatal("expected untrusted host to be rejected")
	}
}

func TestFindAppBundleForExecutable(t *testing.T) {
	if got := findAppBundleForExecutable("/Applications/HelpingHand.app/Contents/MacOS/HelpingHand"); got != "/Applications/HelpingHand.app" {
		t.Fatalf("got %q, want /Applications/HelpingHand.app", got)
	}
	if got := findAppBundleForExecutable("/Users/me/project/desktop/build/bin/HelpingHand"); got != "" {
		t.Fatalf("expected empty bundle path for bare binary, got %q", got)
	}
}

func TestNormalizeSiteURL(t *testing.T) {
	got, err := normalizeSiteURL("bandofthehelpinghand.com/")
	if err != nil || got != "https://bandofthehelpinghand.com" {
		t.Fatalf("got (%q, %v), want https://bandofthehelpinghand.com", got, err)
	}
	got, err = normalizeSiteURL("localhost:4321")
	if err != nil || got != "http://localhost:4321" {
		t.Fatalf("got (%q, %v), want http://localhost:4321", got, err)
	}
	if _, err := normalizeSiteURL("http://bandofthehelpinghand.com"); err == nil {
		t.Fatal("expected plaintext non-loopback URL to be rejected")
	}
	if _, err := normalizeSiteURL("   "); err == nil {
		t.Fatal("expected empty URL to be rejected")
	}
}
