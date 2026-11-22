package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadOutboxValidAndPrivateFieldRejection(t *testing.T) {
	dir := t.TempDir()
	valid := filepath.Join(dir, "HelpingHand.lua")
	content := `HelpingHandDB = {
  ["outbox"] = {
    ["schemaVersion"] = 1,
    ["snapshotId"] = "snap-1",
    ["capturedAt"] = 1700000000,
    ["characters"] = {
      [1] = { ["name"] = "Omaron Skyflame", ["realm"] = "Roleplay PvP" },
    },
  },
}`
	if err := os.WriteFile(valid, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	token, body, payload, err := ReadOutbox(valid)
	if err != nil {
		t.Fatalf("expected valid outbox without token, got error: %v", err)
	}
	if token != "" {
		t.Fatalf("expected empty token, got: %q", token)
	}
	if len(body) == 0 || payload["snapshotId"] != "snap-1" {
		t.Fatalf("unexpected payload: %#v", payload)
	}

	privateFile := filepath.Join(dir, "Private.lua")
	bad := `HelpingHandDB = { ["token"] = "aaa.bbb.ccc", ["outbox"] = { ["schemaVersion"] = 1, ["snapshotId"] = "x", ["secret"] = "leak" } }`
	if err := os.WriteFile(privateFile, []byte(bad), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := ReadOutbox(privateFile); err == nil {
		t.Fatal("expected private field rejection")
	}
}
