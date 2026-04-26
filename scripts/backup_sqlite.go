//go:build ignore

package main

import (
	"database/sql"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

func main() {
	source := flag.String("source", "", "path to source sqlite database")
	dest := flag.String("dest", "", "path to destination sqlite snapshot")
	flag.Parse()

	if strings.TrimSpace(*source) == "" || strings.TrimSpace(*dest) == "" {
		fatalf("usage: go run .\\scripts\\backup_sqlite.go --source <db> --dest <snapshot>")
	}

	sourcePath, err := filepath.Abs(*source)
	if err != nil {
		fatalf("resolve source path: %v", err)
	}
	destPath, err := filepath.Abs(*dest)
	if err != nil {
		fatalf("resolve destination path: %v", err)
	}

	if _, err := os.Stat(sourcePath); err != nil {
		fatalf("source database not found: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		fatalf("create destination directory: %v", err)
	}
	_ = os.Remove(destPath)

	sourceDSN := sourcePath + "?_journal_mode=WAL&_busy_timeout=5000"
	db, err := sql.Open("sqlite", sourceDSN)
	if err != nil {
		fatalf("open source database: %v", err)
	}
	defer db.Close()

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if _, err := db.Exec(`PRAGMA busy_timeout=5000`); err != nil {
		fatalf("set busy_timeout: %v", err)
	}
	_, _ = db.Exec(`PRAGMA wal_checkpoint(PASSIVE)`)

	statement := fmt.Sprintf("VACUUM INTO '%s'", escapeSQLiteString(filepath.ToSlash(destPath)))
	if _, err := db.Exec(statement); err != nil {
		fatalf("sqlite snapshot failed: %v", err)
	}
}

func escapeSQLiteString(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func fatalf(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
