package auth

import (
	"io"
	"net/http"
	neturl "net/url"
	"strings"
	"testing"
	"time"
)

func callbackTestURL(t *testing.T, redirectURI string, path string, query map[string]string) string {
	t.Helper()

	parsed, err := neturl.Parse(redirectURI)
	if err != nil {
		t.Fatalf("parse redirect uri: %v", err)
	}
	parsed.Path = path
	values := parsed.Query()
	for key, value := range query {
		values.Set(key, value)
	}
	parsed.RawQuery = values.Encode()
	return parsed.String()
}

func requestCallbackURL(t *testing.T, url string) {
	t.Helper()

	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		t.Fatalf("callback request failed for %s: %v", url, err)
	}
	defer resp.Body.Close()
	_, _ = io.ReadAll(resp.Body)
}

func TestWaitForCodeIgnoresRequestsWithoutOAuthPayload(t *testing.T) {
	cs, err := StartCallbackServer()
	if err != nil {
		t.Fatalf("start callback server: %v", err)
	}

	requestCallbackURL(t, callbackTestURL(t, cs.RedirectURI, "/favicon.ico", nil))

	code, waitErr := cs.WaitForCode(75 * time.Millisecond)
	if code != "" {
		t.Fatalf("expected empty code after non-callback request, got %q", code)
	}
	if waitErr == nil || !strings.Contains(strings.ToLower(waitErr.Error()), "timed out") {
		t.Fatalf("expected timeout after non-callback request, got %v", waitErr)
	}
}

func TestCallbackServerAllowsFreshRetryAfterOAuthError(t *testing.T) {
	first, err := StartCallbackServer()
	if err != nil {
		t.Fatalf("start first callback server: %v", err)
	}

	requestCallbackURL(t, callbackTestURL(t, first.RedirectURI, "/", map[string]string{
		"error": "access_denied",
	}))

	if _, waitErr := first.WaitForCode(2 * time.Second); waitErr == nil || !strings.Contains(waitErr.Error(), "OAuth error") {
		t.Fatalf("expected OAuth error on first attempt, got %v", waitErr)
	}

	second, err := StartCallbackServer()
	if err != nil {
		t.Fatalf("start second callback server: %v", err)
	}

	requestCallbackURL(t, callbackTestURL(t, second.RedirectURI, "/", map[string]string{
		"code": "fresh-code",
	}))

	code, waitErr := second.WaitForCode(2 * time.Second)
	if waitErr != nil {
		t.Fatalf("expected successful retry, got %v", waitErr)
	}
	if code != "fresh-code" {
		t.Fatalf("expected fresh retry code, got %q", code)
	}
}
