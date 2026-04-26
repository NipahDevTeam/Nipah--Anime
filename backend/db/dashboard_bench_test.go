package db

import (
	"database/sql"
	"fmt"
	"testing"

	_ "modernc.org/sqlite"
)

func benchmarkDatabase(b *testing.B) *Database {
	b.Helper()

	conn, err := sql.Open("sqlite", "file:bench-dashboard?mode=memory&cache=shared")
	if err != nil {
		b.Fatal(err)
	}
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)

	database := &Database{conn: conn}
	if err := database.configureConnection(); err != nil {
		b.Fatal(err)
	}
	if err := database.migrate(); err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = conn.Close() })

	for i := 1; i <= 48; i++ {
		if _, err := conn.Exec(`
			INSERT INTO anime(local_path, title_romaji, title_english, anilist_id, cover_image, banner_image, year, episodes_total)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?)
		`, fmt.Sprintf("C:/anime/%d", i), fmt.Sprintf("Anime %d", i), fmt.Sprintf("Anime %d", i), i, "cover", "banner", 2020+(i%4), 12); err != nil {
			b.Fatal(err)
		}
		if _, err := conn.Exec(`
			INSERT INTO manga(local_path, title_romaji, title_english, anilist_id, cover_image, year, chapters_total)
			VALUES(?, ?, ?, ?, ?, ?, ?)
		`, fmt.Sprintf("C:/manga/%d", i), fmt.Sprintf("Manga %d", i), fmt.Sprintf("Manga %d", i), 1000+i, "cover", 2019+(i%5), 120); err != nil {
			b.Fatal(err)
		}
		if _, err := conn.Exec(`
			INSERT INTO anime_list(anilist_id, mal_id, title, title_english, cover_image, banner_image, status, episodes_watched, episodes_total, score, airing_status, year)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, 2000+i, 3000+i, fmt.Sprintf("Tracked Anime %d", i), fmt.Sprintf("Tracked Anime %d", i), "cover", "banner", []string{"WATCHING", "PLANNING", "COMPLETED", "ON_HOLD"}[i%4], i%12, 12, 8.5, "FINISHED", 2018+(i%6)); err != nil {
			b.Fatal(err)
		}
	}

	for animeID := 1; animeID <= 48; animeID++ {
		for episode := 1; episode <= 12; episode++ {
			if _, err := conn.Exec(`
				INSERT INTO episodes(anime_id, file_path, episode_num, title, watched, progress_s, duration_s)
				VALUES(?, ?, ?, ?, ?, ?, ?)
			`, animeID, fmt.Sprintf("C:/anime/%d/%d.mkv", animeID, episode), episode, fmt.Sprintf("Episode %d", episode), episode <= 5, (episode%4)*120, 1440); err != nil {
				b.Fatal(err)
			}
		}
	}

	for mangaID := 1; mangaID <= 48; mangaID++ {
		for chapter := 1; chapter <= 24; chapter++ {
			if _, err := conn.Exec(`
				INSERT INTO chapters(manga_id, file_path, chapter_num, title, read, progress_page)
				VALUES(?, ?, ?, ?, ?, ?)
			`, mangaID, fmt.Sprintf("C:/manga/%d/%d.cbz", mangaID, chapter), chapter, fmt.Sprintf("Chapter %d", chapter), chapter <= 8, (chapter%5)*4); err != nil {
				b.Fatal(err)
			}
		}
		if _, err := conn.Exec(`
			INSERT INTO watch_history(source_id, source_name, anime_id, anime_title, cover_url, episode_id, episode_num, episode_title, completed)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, "jkanime-es", "JKAnime", fmt.Sprintf("stream-%d", mangaID), fmt.Sprintf("History Anime %d", mangaID), "cover", fmt.Sprintf("ep-%d", mangaID), mangaID, fmt.Sprintf("Episode %d", mangaID), true); err != nil {
			b.Fatal(err)
		}
	}

	return database
}

func BenchmarkGetDashboard(b *testing.B) {
	database := benchmarkDatabase(b)
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		dash, err := database.GetDashboard()
		if err != nil {
			b.Fatal(err)
		}
		if len(dash.RecentAnime) == 0 || len(dash.RecentManga) == 0 {
			b.Fatal("expected populated dashboard data")
		}
	}
}
