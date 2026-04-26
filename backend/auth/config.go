// Package auth handles OAuth2 authentication with AniList and MyAnimeList.
package auth

import "fmt"

const (
	// AniList - register at https://anilist.co/settings/developer
	AniListClientID     = "37539"
	AniListClientSecret = "bVzxIF105ukQtN9gaGrLXF1xbYHIt2tAbru8isv0"

	// MyAnimeList - register at https://myanimelist.net/apiconfig
	// MAL uses PKCE for native apps, so no client secret is needed.
	MALClientID = "1b7376ef23038c023c533aa78bcb02c6"

	// Desktop OAuth callback.
	// Register this exact URL in AniList and MyAnimeList.
	OAuthCallbackHost = "localhost"
	OAuthCallbackBind = "127.0.0.1"
	OAuthCallbackPort = 18080
	OAuthCallbackPath = ""
)

func OAuthRedirectURI() string {
	return fmt.Sprintf("http://%s:%d%s", OAuthCallbackHost, OAuthCallbackPort, OAuthCallbackPath)
}

func OAuthListenAddress() string {
	return fmt.Sprintf("%s:%d", OAuthCallbackBind, OAuthCallbackPort)
}
