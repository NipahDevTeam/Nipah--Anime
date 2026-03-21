package db

// settings.go — read and write user preferences from the settings table.

// GetSetting returns a single setting value by key.
// Returns the defaultVal if the key doesn't exist.
func (d *Database) GetSetting(key, defaultVal string) string {
	var val string
	err := d.conn.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&val)
	if err != nil {
		return defaultVal
	}
	return val
}

// SetSetting writes a key/value pair to the settings table.
func (d *Database) SetSetting(key, value string) error {
	_, err := d.conn.Exec(`
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, key, value)
	return err
}

// GetAllSettings returns every setting as a map.
func (d *Database) GetAllSettings() (map[string]string, error) {
	rows, err := d.conn.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			out[k] = v
		}
	}
	return out, nil
}

// SetSettings writes multiple settings in a single transaction.
func (d *Database) SetSettings(settings map[string]string) error {
	tx, err := d.conn.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.Prepare(`
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for k, v := range settings {
		if _, err := stmt.Exec(k, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}
