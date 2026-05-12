package main

import (
	"encoding/json"
	"os"
	"testing"
)

func TestUpdaterVersionMatchesWailsProductVersion(t *testing.T) {
	data, err := os.ReadFile("wails.json")
	if err != nil {
		t.Fatalf("read wails.json: %v", err)
	}

	var cfg struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
		} `json:"info"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse wails.json: %v", err)
	}

	if cfg.Info.ProductVersion == "" {
		t.Fatal("wails.json info.productVersion should not be empty")
	}
	if cfg.Info.ProductVersion != appVersion {
		t.Fatalf("updater appVersion (%s) must match wails.json productVersion (%s)", appVersion, cfg.Info.ProductVersion)
	}
}
