package db

import "time"

// OAuthToken represents a stored OAuth token for AniList or MAL.
type OAuthToken struct {
	Provider     string    `json:"provider"` // "anilist" or "mal"
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	Username     string    `json:"username"`
	UserID       int       `json:"user_id"`
	AvatarURL    string    `json:"avatar_url"`
	ExpiresAt    time.Time `json:"expires_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// SaveOAuthToken stores or updates an OAuth token.
func (d *Database) SaveOAuthToken(t OAuthToken) error {
	_, err := d.conn.Exec(`
		INSERT INTO oauth_tokens
			(provider, access_token, refresh_token, username, user_id, avatar_url, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(provider) DO UPDATE SET
			access_token  = excluded.access_token,
			refresh_token = excluded.refresh_token,
			username      = excluded.username,
			user_id       = excluded.user_id,
			avatar_url    = excluded.avatar_url,
			expires_at    = excluded.expires_at,
			updated_at    = CURRENT_TIMESTAMP
	`, t.Provider, t.AccessToken, t.RefreshToken, t.Username, t.UserID, t.AvatarURL,
		t.ExpiresAt.Format("2006-01-02 15:04:05"))
	return err
}

// GetOAuthToken retrieves the stored token for a provider.
func (d *Database) GetOAuthToken(provider string) (*OAuthToken, error) {
	var t OAuthToken
	var expiresAt, updatedAt string
	err := d.conn.QueryRow(`
		SELECT provider, access_token, refresh_token, username, user_id,
		       COALESCE(avatar_url, ''), expires_at, updated_at
		FROM oauth_tokens WHERE provider = ?
	`, provider).Scan(
		&t.Provider, &t.AccessToken, &t.RefreshToken, &t.Username, &t.UserID,
		&t.AvatarURL, &expiresAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	t.ExpiresAt = parseOAuthTime(expiresAt)
	t.UpdatedAt = parseOAuthTime(updatedAt)
	return &t, nil
}

// DeleteOAuthToken removes the token for a provider (logout).
func (d *Database) DeleteOAuthToken(provider string) error {
	_, err := d.conn.Exec(`DELETE FROM oauth_tokens WHERE provider = ?`, provider)
	return err
}

// UpdateOAuthAccessToken updates just the access token and expiry (for token refresh).
func (d *Database) UpdateOAuthAccessToken(provider, accessToken, refreshToken string, expiresAt time.Time) error {
	_, err := d.conn.Exec(`
		UPDATE oauth_tokens
		SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE provider = ?
	`, accessToken, refreshToken, expiresAt.Format("2006-01-02 15:04:05"), provider)
	return err
}

func parseOAuthTime(value string) time.Time {
	layouts := []string{
		"2006-01-02 15:04:05",
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed
		}
	}
	return time.Time{}
}
