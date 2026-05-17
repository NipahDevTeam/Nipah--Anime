package animepahe

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestAnimePaheHasUsableCookiesRejectsEmptyOrIrrelevantCookies(t *testing.T) {
	tests := []struct {
		name    string
		cookies []*http.Cookie
		want    bool
	}{
		{name: "no cookies", cookies: nil, want: false},
		{name: "analytics cookie only", cookies: []*http.Cookie{{Name: "_ga", Value: "123"}}, want: false},
		{name: "ddos guard cookie present", cookies: []*http.Cookie{{Name: "__ddg1_", Value: "token"}}, want: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := animePaheHasUsableCookies(tc.cookies); got != tc.want {
				t.Fatalf("animePaheHasUsableCookies() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestAnimePaheBrowserReadyRequiresUsableCookiesAndNonChallengePage(t *testing.T) {
	cookies := []*http.Cookie{{Name: "__ddg1_", Value: "token"}}

	if animePaheBrowserReady(cookies, "DDoS-Guard") {
		t.Fatal("expected challenge title to remain blocked")
	}
	if animePaheBrowserReady(nil, "AnimePahe") {
		t.Fatal("expected missing cookies to remain blocked")
	}
	if !animePaheBrowserReady(cookies, "AnimePahe - Home") {
		t.Fatal("expected usable cookies plus non-challenge title to be ready")
	}
}

func TestGetValidCookiesWithContextDeduplicatesConcurrentSolve(t *testing.T) {
	cachedMu.Lock()
	cachedCookiesByBase = map[string]animePaheCookieCacheEntry{}
	inflightSolveByBase = map[string]*animePaheCookieSolveState{}
	cachedMu.Unlock()

	started := make(chan struct{}, 1)
	release := make(chan struct{})

	originalSolve := solveAnimePaheDDoSGuard
	defer func() { solveAnimePaheDDoSGuard = originalSolve }()

	var callsMu sync.Mutex
	calls := 0
	solveAnimePaheDDoSGuard = func(ctx context.Context, targetBase string) ([]*http.Cookie, error) {
		callsMu.Lock()
		calls++
		callsMu.Unlock()
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-release:
			return []*http.Cookie{{Name: "__ddg2_", Value: "token"}}, nil
		}
	}

	var leftCookies []*http.Cookie
	var rightCookies []*http.Cookie
	var leftErr error
	var rightErr error

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		leftCookies, leftErr = getValidCookiesWithContext(context.Background(), "https://animepahe.pw")
	}()
	<-started
	go func() {
		defer wg.Done()
		rightCookies, rightErr = getValidCookiesWithContext(context.Background(), "https://animepahe.pw")
	}()

	close(release)
	wg.Wait()

	if leftErr != nil || rightErr != nil {
		t.Fatalf("expected both callers to succeed, got left=%v right=%v", leftErr, rightErr)
	}
	if len(leftCookies) != 1 || len(rightCookies) != 1 {
		t.Fatalf("expected both callers to receive cookies, got left=%d right=%d", len(leftCookies), len(rightCookies))
	}

	callsMu.Lock()
	defer callsMu.Unlock()
	if calls != 1 {
		t.Fatalf("expected concurrent cookie solve to be deduplicated, got %d solve calls", calls)
	}
}

func TestGetValidCookiesCachesHealthyStatePerBase(t *testing.T) {
	cachedMu.Lock()
	cachedCookiesByBase = map[string]animePaheCookieCacheEntry{}
	inflightSolveByBase = map[string]*animePaheCookieSolveState{}
	cachedMu.Unlock()

	originalSolve := solveAnimePaheDDoSGuard
	defer func() { solveAnimePaheDDoSGuard = originalSolve }()

	var callsMu sync.Mutex
	callsByBase := map[string]int{}
	solveAnimePaheDDoSGuard = func(ctx context.Context, targetBase string) ([]*http.Cookie, error) {
		callsMu.Lock()
		callsByBase[targetBase]++
		call := callsByBase[targetBase]
		callsMu.Unlock()
		return []*http.Cookie{{Name: "__ddg2_", Value: targetBase + "-" + string(rune('0'+call))}}, nil
	}

	firstPW, err := getValidCookiesWithContext(context.Background(), "https://animepahe.pw")
	if err != nil {
		t.Fatalf("first .pw solve failed: %v", err)
	}
	firstSI, err := getValidCookiesWithContext(context.Background(), "https://animepahe.si")
	if err != nil {
		t.Fatalf("first .si solve failed: %v", err)
	}
	secondPW, err := getValidCookiesWithContext(context.Background(), "https://animepahe.pw")
	if err != nil {
		t.Fatalf("second .pw lookup failed: %v", err)
	}

	if len(firstPW) != 1 || len(firstSI) != 1 || len(secondPW) != 1 {
		t.Fatalf("expected cookies for all lookups, got pw=%d si=%d pw2=%d", len(firstPW), len(firstSI), len(secondPW))
	}
	if firstPW[0].Value != secondPW[0].Value {
		t.Fatalf("expected .pw cookies to remain cached across mirror switch, got first=%q second=%q", firstPW[0].Value, secondPW[0].Value)
	}

	callsMu.Lock()
	defer callsMu.Unlock()
	if callsByBase["https://animepahe.pw"] != 1 {
		t.Fatalf("expected exactly one solve for .pw, got %d", callsByBase["https://animepahe.pw"])
	}
	if callsByBase["https://animepahe.si"] != 1 {
		t.Fatalf("expected exactly one solve for .si, got %d", callsByBase["https://animepahe.si"])
	}
}

func TestGetValidCookiesWithContextHonorsCancellationWhileWaitingOnInflightSolve(t *testing.T) {
	cachedMu.Lock()
	cachedCookiesByBase = map[string]animePaheCookieCacheEntry{}
	inflightSolveByBase = map[string]*animePaheCookieSolveState{}
	cachedMu.Unlock()

	started := make(chan struct{}, 1)
	release := make(chan struct{})

	originalSolve := solveAnimePaheDDoSGuard
	defer func() { solveAnimePaheDDoSGuard = originalSolve }()

	solveAnimePaheDDoSGuard = func(ctx context.Context, targetBase string) ([]*http.Cookie, error) {
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-release:
			return []*http.Cookie{{Name: "__ddg2_", Value: "token"}}, nil
		}
	}

	firstDone := make(chan struct{})
	go func() {
		defer close(firstDone)
		_, _ = getValidCookiesWithContext(context.Background(), "https://animepahe.pw")
	}()
	<-started

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	_, err := getValidCookiesWithContext(ctx, "https://animepahe.pw")
	if err == nil {
		t.Fatal("expected waiting caller to stop on context cancellation")
	}

	close(release)
	<-firstDone
}

func TestAnimePaheSelectBrowserFetchContentPrefersHTMLForDocumentPages(t *testing.T) {
	html := `<div><a data-src="https://kwik.cx/e/test">ENG · 1080p</a></div>`

	got := animePaheSelectBrowserFetchContent("ENG · 1080p", "", html, false)
	if got != html {
		t.Fatalf("expected document fetch to preserve HTML markup, got %q", got)
	}
}

func TestAnimePaheSelectBrowserFetchContentPrefersTextForAjaxResponses(t *testing.T) {
	got := animePaheSelectBrowserFetchContent(`{"ok":true}`, "", "<html><body>{\"ok\":true}</body></html>", true)
	if got != `{"ok":true}` {
		t.Fatalf("expected ajax fetch to prefer plain response text, got %q", got)
	}
}

func TestAnimePaheSelectBrowserFetchContentFallsBackToPreTextForAjaxResponses(t *testing.T) {
	got := animePaheSelectBrowserFetchContent("", `{"data":[1,2,3]}`, "<html><body><pre>{\"data\":[1,2,3]}</pre></body></html>", true)
	if got != `{"data":[1,2,3]}` {
		t.Fatalf("expected ajax fetch to prefer preformatted text when body text is empty, got %q", got)
	}
}
