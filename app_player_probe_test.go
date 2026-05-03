package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"miruro/backend/extensions"
	"miruro/backend/extensions/animeav1"
	"miruro/backend/extensions/animeheaven"
)

type playerProbeProviderReport struct {
	SourceID      string                 `json:"source_id"`
	SourceName    string                 `json:"source_name"`
	Query         string                 `json:"query"`
	SelectedTitle string                 `json:"selected_title"`
	SelectedID    string                 `json:"selected_id"`
	Diagnosis     map[string]interface{} `json:"diagnosis"`
}

type playerProbeReport struct {
	GeneratedAt string                      `json:"generated_at"`
	Overall     string                      `json:"overall"`
	Providers   []playerProbeProviderReport `json:"providers"`
}

func TestPlayerProbeLive(t *testing.T) {
	if os.Getenv("NIPAH_PLAYER_PROBE") != "1" {
		t.Skip("set NIPAH_PLAYER_PROBE=1 to run live source and proxy diagnostics")
	}

	app := &App{
		registry: extensions.NewRegistry(),
	}
	app.registry.RegisterAnime(animeav1.New())
	app.registry.RegisterAnime(animeheaven.New())

	providers := []struct {
		sourceID string
		query    string
		lang     extensions.Language
	}{
		{sourceID: "animeav1-es", query: firstEnv("NIPAH_PLAYER_PROBE_QUERY_ANIMEAV1", "Sousou no Frieren"), lang: extensions.LangSpanish},
		{sourceID: "animeheaven-en", query: firstEnv("NIPAH_PLAYER_PROBE_QUERY_ANIMEHEAVEN", "Frieren"), lang: extensions.LangEnglish},
	}
	if only := strings.ToLower(strings.TrimSpace(os.Getenv("NIPAH_PLAYER_PROBE_ONLY"))); only != "" {
		filtered := make([]struct {
			sourceID string
			query    string
			lang     extensions.Language
		}, 0, len(providers))
		for _, provider := range providers {
			if provider.sourceID == only {
				filtered = append(filtered, provider)
			}
		}
		if len(filtered) == 0 {
			t.Fatalf("no live probe provider configured for %q", only)
		}
		providers = filtered
	}

	report := playerProbeReport{
		GeneratedAt: firstEnv("NIPAH_PLAYER_PROBE_GENERATED_AT", ""),
		Overall:     "unknown",
		Providers:   make([]playerProbeProviderReport, 0, len(providers)),
	}

	classifications := make([]string, 0, len(providers))

	for _, provider := range providers {
		src, err := app.registry.GetAnime(provider.sourceID)
		if err != nil {
			t.Fatalf("source lookup failed for %s: %v", provider.sourceID, err)
		}

		results, err := src.Search(provider.query, provider.lang)
		if err != nil {
			t.Fatalf("search failed for %s: %v", provider.sourceID, err)
		}
		if len(results) == 0 {
			t.Fatalf("no search results for %s query %q", provider.sourceID, provider.query)
		}

		selected := results[0]
		diagnosis, err := app.DiagnoseOnlinePlaybackSource(provider.sourceID, selected.ID, "")
		if err != nil {
			t.Fatalf("diagnosis failed for %s: %v", provider.sourceID, err)
		}

		classification, _ := diagnosis["classification"].(string)
		classifications = append(classifications, classification)
		report.Providers = append(report.Providers, playerProbeProviderReport{
			SourceID:      provider.sourceID,
			SourceName:    src.Name(),
			Query:         provider.query,
			SelectedTitle: selected.Title,
			SelectedID:    selected.ID,
			Diagnosis:     diagnosis,
		})

		encoded, _ := json.MarshalIndent(diagnosis, "", "  ")
		t.Logf("%s diagnosis:\n%s", provider.sourceID, string(encoded))
	}

	report.Overall = overallPlayerProbeClassification(classifications)
	writePlayerProbeArtifacts(t, report)
}

func writePlayerProbeArtifacts(t *testing.T, report playerProbeReport) {
	t.Helper()

	reportPath := strings.TrimSpace(os.Getenv("NIPAH_PLAYER_PROBE_REPORT"))
	if reportPath == "" {
		return
	}

	jsonBytes, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatalf("marshal report: %v", err)
	}
	if err := os.WriteFile(reportPath, jsonBytes, 0644); err != nil {
		t.Fatalf("write report json: %v", err)
	}

	markdownPath := strings.TrimSuffix(reportPath, ".json") + ".md"
	if err := os.WriteFile(markdownPath, []byte(renderPlayerProbeMarkdown(report)), 0644); err != nil {
		t.Fatalf("write report markdown: %v", err)
	}
}

func renderPlayerProbeMarkdown(report playerProbeReport) string {
	var b strings.Builder
	b.WriteString("# Online Player Probe Report\n\n")
	b.WriteString(fmt.Sprintf("- Overall: `%s`\n", report.Overall))
	if report.GeneratedAt != "" {
		b.WriteString(fmt.Sprintf("- Generated at: `%s`\n", report.GeneratedAt))
	}
	b.WriteString("\n")

	for _, provider := range report.Providers {
		classification, _ := provider.Diagnosis["classification"].(string)
		reason, _ := provider.Diagnosis["classification_reason"].(string)
		b.WriteString(fmt.Sprintf("## %s\n\n", provider.SourceName))
		b.WriteString(fmt.Sprintf("- Source ID: `%s`\n", provider.SourceID))
		b.WriteString(fmt.Sprintf("- Query: `%s`\n", provider.Query))
		b.WriteString(fmt.Sprintf("- Selected title: `%s`\n", provider.SelectedTitle))
		b.WriteString(fmt.Sprintf("- Classification: `%s`\n", classification))
		if reason != "" {
			b.WriteString(fmt.Sprintf("- Reason: %s\n", reason))
		}

		if sourceProbe, ok := provider.Diagnosis["source_probe"].(map[string]interface{}); ok {
			b.WriteString(fmt.Sprintf("- Episodes found: `%v`\n", sourceProbe["episodes_count"]))
			b.WriteString(fmt.Sprintf("- Raw streams: `%v`\n", sourceProbe["raw_streams_count"]))
			b.WriteString(fmt.Sprintf("- Playable streams: `%v`\n", sourceProbe["playable_streams_count"]))
			b.WriteString(fmt.Sprintf("- Stream kind: `%v`\n", sourceProbe["stream_kind"]))
			b.WriteString(fmt.Sprintf("- Stream URL: `%v`\n", sourceProbe["stream_url"]))
		}

		if proxyProbe, ok := provider.Diagnosis["proxy_probe"].(map[string]interface{}); ok {
			b.WriteString(fmt.Sprintf("- Proxy upstream status: `%v`\n", proxyProbe["upstream_status"]))
			b.WriteString(fmt.Sprintf("- Proxy content type: `%v`\n", proxyProbe["upstream_content_type"]))
			b.WriteString(fmt.Sprintf("- Proxy classification: `%v`\n", proxyProbe["classification"]))
			b.WriteString(fmt.Sprintf("- Proxy reason: `%v`\n", proxyProbe["classification_reason"]))
		}

		b.WriteString("\n")
	}

	return b.String()
}

func overallPlayerProbeClassification(classifications []string) string {
	allCompatible := len(classifications) > 0
	for _, item := range classifications {
		if item == "proxy-broken" {
			return "proxy-broken"
		}
		if item != "provider-compatible" {
			allCompatible = false
		}
	}
	if allCompatible {
		return "integrated-player-broken"
	}
	if len(classifications) > 0 {
		return classifications[0]
	}
	return "unknown"
}

func firstEnv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
