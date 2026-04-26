// Package httpclient provides Chrome-fingerprinted HTTP sessions for all scrapers.
// Uses azuretls-client to impersonate Chrome's TLS (JA3) and HTTP/2 fingerprints,
// making requests indistinguishable from a real Chrome browser at the transport layer.
package httpclient

import (
	"net"
	"net/http"
	"time"

	azuretls "github.com/Noooste/azuretls-client"
)

const defaultUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

var sharedTransport = &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
	ForceAttemptHTTP2:     true,
	MaxIdleConns:          64,
	MaxIdleConnsPerHost:   16,
	IdleConnTimeout:       90 * time.Second,
	TLSHandshakeTimeout:   10 * time.Second,
	ExpectContinueTimeout: 1 * time.Second,
}

// NewSession creates a Chrome-fingerprinted HTTP session with standard browser headers.
// timeout is in seconds.
func NewSession(timeout int) *azuretls.Session {
	s := azuretls.NewSession()
	s.SetTimeout(time.Duration(timeout) * time.Second)
	// Chrome TLS + H2 fingerprint is the default, but set explicitly for clarity
	s.Browser = azuretls.Chrome
	s.OrderedHeaders = azuretls.OrderedHeaders{
		{"Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"},
		{"Accept-Language", "es-419,es;q=0.9,en;q=0.8"},
		{"Cache-Control", "no-cache"},
		{"User-Agent", defaultUA},
		{"Sec-Ch-Ua", `"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"`},
		{"Sec-Ch-Ua-Mobile", "?0"},
		{"Sec-Ch-Ua-Platform", `"Windows"`},
		{"Sec-Fetch-Dest", "document"},
		{"Sec-Fetch-Mode", "navigate"},
		{"Sec-Fetch-Site", "none"},
		{"Sec-Fetch-User", "?1"},
		{"Upgrade-Insecure-Requests", "1"},
	}
	return s
}

// Get performs a GET request with an optional referer header.
func Get(s *azuretls.Session, url, referer string) (*azuretls.Response, error) {
	req := &azuretls.Request{
		Url:    url,
		Method: "GET",
	}
	if referer != "" {
		req.OrderedHeaders = azuretls.OrderedHeaders{
			{"Referer", referer},
		}
	}
	return s.Do(req)
}

// Post performs a POST request with a body and optional content type.
func Post(s *azuretls.Session, url string, body interface{}, contentType string) (*azuretls.Response, error) {
	req := &azuretls.Request{
		Url:    url,
		Method: "POST",
		Body:   body,
	}
	if contentType != "" {
		req.OrderedHeaders = azuretls.OrderedHeaders{
			{"Content-Type", contentType},
		}
	}
	return s.Do(req)
}

// NewStdClient returns a pooled standard-library HTTP client for non-scraper calls.
func NewStdClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: sharedTransport,
	}
}
