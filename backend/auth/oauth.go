package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// callbackResult is returned by the ephemeral localhost server after OAuth redirect.
type callbackResult struct {
	Code  string
	State string
	Error string
}

// RandomString generates a cryptographically random hex string of n bytes.
func RandomString(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// CallbackServer manages the local HTTP server for OAuth callbacks.
type CallbackServer struct {
	Port        int
	RedirectURI string
	listener    net.Listener
	srv         *http.Server
	resultCh    chan callbackResult
	closeOnce   sync.Once
	sendOnce    sync.Once
}

// StartCallbackServer binds to the configured localhost callback port.
// A fixed redirect URI keeps provider configuration stable across launches.
func StartCallbackServer() (*CallbackServer, error) {
	listener, err := net.Listen("tcp", OAuthListenAddress())
	if err != nil {
		return nil, fmt.Errorf("failed to start callback server on %s: %w", OAuthRedirectURI(), err)
	}

	port := listener.Addr().(*net.TCPAddr).Port
	resultCh := make(chan callbackResult, 1)
	callbackPath := "/"
	if OAuthCallbackPath != "" {
		callbackPath = OAuthCallbackPath
	}

	cs := &CallbackServer{
		Port:        port,
		RedirectURI: OAuthRedirectURI(),
		listener:    listener,
		resultCh:    resultCh,
	}

	mux := http.NewServeMux()
	mux.HandleFunc(callbackPath, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != callbackPath && !(callbackPath == "/" && r.URL.Path == "") {
			http.NotFound(w, r)
			return
		}

		q := r.URL.Query()
		errMsg := strings.TrimSpace(q.Get("error"))
		code := strings.TrimSpace(q.Get("code"))
		state := strings.TrimSpace(q.Get("state"))

		if errMsg == "" && code == "" {
			http.NotFound(w, r)
			return
		}

		cs.sendOnce.Do(func() {
			resultCh <- callbackResult{
				Code:  code,
				State: state,
				Error: errMsg,
			}
		})

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if errMsg != "" {
			fmt.Fprintf(w, `<html><body style="background:#0a0a0e;color:#f0f0f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Error de autenticacion</h2><p>%s</p><p style="color:#888">Puedes cerrar esta pestana.</p></div></body></html>`, errMsg)
			return
		}
		fmt.Fprint(w, `<html><body style="background:#0a0a0e;color:#f0f0f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#f5a623">Conectado!</h2><p>Tu cuenta ha sido vinculada a Nipah! Anime.</p><p style="color:#888">Puedes cerrar esta pestana.</p></div></body></html>`)
	})

	if callbackPath != "/" {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, callbackPath, http.StatusTemporaryRedirect)
		})
	}
	cs.srv = &http.Server{Handler: mux}

	go func() {
		_ = cs.srv.Serve(listener)
	}()

	return cs, nil
}

// WaitForCode blocks until the OAuth callback arrives or the timeout is reached.
func (cs *CallbackServer) WaitForCode(timeout time.Duration) (code string, err error) {
	defer cs.Close()

	select {
	case res := <-cs.resultCh:
		if res.Error != "" {
			return "", fmt.Errorf("OAuth error: %s", res.Error)
		}
		if res.Code == "" {
			return "", fmt.Errorf("no authorization code received")
		}
		return res.Code, nil
	case <-time.After(timeout):
		return "", fmt.Errorf("OAuth callback timed out after %v", timeout)
	}
}

func (cs *CallbackServer) Close() {
	if cs == nil {
		return
	}
	cs.closeOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = cs.srv.Shutdown(ctx)
		if cs.listener != nil {
			_ = cs.listener.Close()
		}
	})
}
