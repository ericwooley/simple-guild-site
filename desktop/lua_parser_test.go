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

func TestGuildBankHistoryPreservesEmptyEntryArrays(t *testing.T) {
	path := filepath.Join(t.TempDir(), "HelpingHand.lua")
	content := `HelpingHandDB = {outbox = {schemaVersion = 1, snapshotId = "guild-bank",
	  banks = {{name = "Guild bank tab 1", sourceKind = "guild-bank", guildTabId = 1, items = {}}},
	  guildBankHistory = {{tabId = 1, observedAt = 1700000000, entries = {}}}}}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	_, _, payload, err := ReadOutbox(path)
	if err != nil {
		t.Fatal(err)
	}
	history := payload["guildBankHistory"].([]any)
	entries := history[0].(map[string]any)["entries"].([]any)
	if len(entries) != 0 {
		t.Fatal("Expected an empty history list.")
	}
}
