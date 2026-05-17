package main

import (
	"strings"

	"miruro/backend/extensions"
	"miruro/backend/server"
)

type mediaProxyProbeFunc func(rawURL, referer, cookie string) (*server.MediaProxyProbeResult, error)

func shouldProbeIntegratedStreamCandidates(sourceID string) bool {
	switch strings.ToLower(strings.TrimSpace(sourceID)) {
	case "animepahe-en", "animeav1-es", "animeheaven-en":
		return true
	default:
		return false
	}
}

func chooseIntegratedPlaybackStreamSource(sourceID string, candidates []extensions.StreamSource, probe mediaProxyProbeFunc) (extensions.StreamSource, bool) {
	if len(candidates) == 0 {
		return extensions.StreamSource{}, false
	}

	fallback := candidates[0]
	if !shouldProbeIntegratedStreamCandidates(sourceID) || len(candidates) == 1 {
		return fallback, true
	}

	for _, candidate := range candidates {
		if !integratedCandidateIsHLS(candidate.URL) {
			continue
		}
		if probe == nil {
			return candidate, true
		}

		result, err := probe(candidate.URL, candidate.Referer, candidate.Cookie)
		if err != nil {
			continue
		}
		if result == nil || result.Classification != "proxy-broken" {
			return candidate, true
		}
	}

	for _, candidate := range candidates {
		if integratedCandidateIsHLS(candidate.URL) {
			continue
		}
		if probe == nil {
			return candidate, true
		}

		result, err := probe(candidate.URL, candidate.Referer, candidate.Cookie)
		if err != nil {
			continue
		}
		if result == nil || result.Classification != "proxy-broken" {
			return candidate, true
		}
	}

	return fallback, true
}

func integratedCandidateIsHLS(raw string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(raw)), ".m3u8")
}
