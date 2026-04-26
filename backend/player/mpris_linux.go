//go:build linux

package player

import (
	"fmt"
	"hash/fnv"
	"strings"
	"unicode"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/introspect"
	"github.com/godbus/dbus/v5/prop"
)

const (
	mprisBusName = "org.mpris.MediaPlayer2.nipahanime"
	mprisPath    = dbus.ObjectPath("/org/mpris/MediaPlayer2")
)

type linuxMPRISBridge struct {
	conn    *dbus.Conn
	props   *prop.Properties
	manager *Manager
}

type mprisRoot struct{ bridge *linuxMPRISBridge }
type mprisPlayer struct{ bridge *linuxMPRISBridge }

func newMPRISBridge(m *Manager) mprisBridge {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return nil
	}

	reply, err := conn.RequestName(mprisBusName, dbus.NameFlagDoNotQueue)
	if err != nil || reply != dbus.RequestNameReplyPrimaryOwner {
		conn.Close()
		return nil
	}

	bridge := &linuxMPRISBridge{conn: conn, manager: m}
	root := &mprisRoot{bridge: bridge}
	player := &mprisPlayer{bridge: bridge}

	if err := conn.Export(root, mprisPath, "org.mpris.MediaPlayer2"); err != nil {
		conn.Close()
		return nil
	}
	if err := conn.Export(player, mprisPath, "org.mpris.MediaPlayer2.Player"); err != nil {
		conn.Close()
		return nil
	}

	propsSpec := map[string]map[string]*prop.Prop{
		"org.mpris.MediaPlayer2": {
			"CanQuit":             {Value: true, Emit: prop.EmitTrue},
			"CanRaise":            {Value: false, Emit: prop.EmitTrue},
			"CanSetFullscreen":    {Value: false, Emit: prop.EmitTrue},
			"Fullscreen":          {Value: false, Emit: prop.EmitFalse},
			"HasTrackList":        {Value: false, Emit: prop.EmitTrue},
			"Identity":            {Value: "Nipah! Anime", Emit: prop.EmitConst},
			"DesktopEntry":        {Value: "nipah-anime", Emit: prop.EmitConst},
			"SupportedUriSchemes": {Value: []string{"file", "http", "https"}, Emit: prop.EmitConst},
			"SupportedMimeTypes": {
				Value: []string{
					"video/mp4",
					"video/x-matroska",
					"application/x-mpegURL",
					"application/vnd.apple.mpegurl",
				},
				Emit: prop.EmitConst,
			},
		},
		"org.mpris.MediaPlayer2.Player": {
			"PlaybackStatus": {Value: "Stopped", Emit: prop.EmitTrue},
			"LoopStatus":     {Value: "None", Emit: prop.EmitFalse},
			"Rate":           {Value: 1.0, Emit: prop.EmitFalse},
			"Shuffle":        {Value: false, Emit: prop.EmitFalse},
			"Metadata":       {Value: map[string]dbus.Variant{}, Emit: prop.EmitTrue},
			"Volume":         {Value: 1.0, Emit: prop.EmitFalse},
			"Position":       {Value: int64(0), Emit: prop.EmitTrue},
			"MinimumRate":    {Value: 1.0, Emit: prop.EmitConst},
			"MaximumRate":    {Value: 1.0, Emit: prop.EmitConst},
			"CanGoNext":      {Value: false, Emit: prop.EmitConst},
			"CanGoPrevious":  {Value: false, Emit: prop.EmitConst},
			"CanPlay":        {Value: true, Emit: prop.EmitConst},
			"CanPause":       {Value: true, Emit: prop.EmitConst},
			"CanSeek":        {Value: true, Emit: prop.EmitConst},
			"CanControl":     {Value: true, Emit: prop.EmitConst},
		},
	}

	props, err := prop.Export(conn, mprisPath, propsSpec)
	if err != nil {
		conn.Close()
		return nil
	}
	bridge.props = props

	node := &introspect.Node{
		Name: string(mprisPath),
		Interfaces: []introspect.Interface{
			introspect.IntrospectData,
			prop.IntrospectData,
			{
				Name:    "org.mpris.MediaPlayer2",
				Methods: introspect.Methods(root),
			},
			{
				Name:    "org.mpris.MediaPlayer2.Player",
				Methods: introspect.Methods(player),
			},
		},
	}
	conn.Export(introspect.NewIntrospectable(node), mprisPath, "org.freedesktop.DBus.Introspectable")

	m.OnStateChange = bridge.handleStateChange
	bridge.handleStateChange(m.State.Copy())
	return bridge
}

func (b *linuxMPRISBridge) Close() error {
	if b == nil || b.conn == nil {
		return nil
	}
	_, _ = b.conn.ReleaseName(mprisBusName)
	return b.conn.Close()
}

func (b *linuxMPRISBridge) handleStateChange(snapshot PlaybackSnapshot) {
	if b == nil || b.props == nil {
		return
	}
	b.props.SetMust("org.mpris.MediaPlayer2.Player", "PlaybackStatus", playbackStatus(snapshot))
	b.props.SetMust("org.mpris.MediaPlayer2.Player", "Position", secondsToMicroseconds(snapshot.PositionSec))
	b.props.SetMust("org.mpris.MediaPlayer2.Player", "Metadata", buildMPRISMetadata(snapshot))
}

func playbackStatus(snapshot PlaybackSnapshot) string {
	if !snapshot.Active {
		return "Stopped"
	}
	if snapshot.Paused {
		return "Paused"
	}
	return "Playing"
}

func secondsToMicroseconds(seconds float64) int64 {
	if seconds <= 0 {
		return 0
	}
	return int64(seconds * 1_000_000)
}

func buildMPRISMetadata(snapshot PlaybackSnapshot) map[string]dbus.Variant {
	title := strings.TrimSpace(snapshot.EpisodeTitle)
	if title == "" {
		title = strings.TrimSpace(snapshot.AnimeTitle)
	}
	album := strings.TrimSpace(snapshot.AnimeTitle)
	if album == "" {
		album = "Nipah! Anime"
	}

	metadata := map[string]dbus.Variant{
		"mpris:trackid": dbus.MakeVariant(buildMPRISTrackID(snapshot)),
		"xesam:title":   dbus.MakeVariant(title),
		"xesam:album":   dbus.MakeVariant(album),
		"xesam:url":     dbus.MakeVariant(snapshot.FilePath),
	}
	if snapshot.DurationSec > 0 {
		metadata["mpris:length"] = dbus.MakeVariant(secondsToMicroseconds(snapshot.DurationSec))
	}
	if snapshot.EpisodeNum > 0 {
		metadata["xesam:trackNumber"] = dbus.MakeVariant(int32(snapshot.EpisodeNum))
	}
	return metadata
}

func buildMPRISTrackID(snapshot PlaybackSnapshot) dbus.ObjectPath {
	if snapshot.EpisodeID > 0 {
		return dbus.ObjectPath(fmt.Sprintf("%s/track/episode_%d", mprisPath, snapshot.EpisodeID))
	}

	seed := firstNonEmptyTrackSeed(
		snapshot.FilePath,
		snapshot.AnimeTitle,
		snapshot.EpisodeTitle,
	)
	if seed == "" {
		return dbus.ObjectPath(fmt.Sprintf("%s/track/online", mprisPath))
	}

	sanitized := sanitizeMPRISPathSegment(seed)
	if sanitized == "" {
		h := fnv.New64a()
		_, _ = h.Write([]byte(seed))
		sanitized = fmt.Sprintf("online_%x", h.Sum64())
	}
	return dbus.ObjectPath(fmt.Sprintf("%s/track/%s", mprisPath, sanitized))
}

func firstNonEmptyTrackSeed(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func sanitizeMPRISPathSegment(value string) string {
	var b strings.Builder
	lastUnderscore := false
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(b.String(), "_")
}

func (r *mprisRoot) Raise() *dbus.Error { return nil }

func (r *mprisRoot) Quit() *dbus.Error {
	if err := r.bridge.manager.Quit(); err != nil {
		return dbus.MakeFailedError(err)
	}
	return nil
}

func (p *mprisPlayer) Play() *dbus.Error {
	if err := p.bridge.manager.Play(); err != nil {
		return dbus.MakeFailedError(err)
	}
	return nil
}

func (p *mprisPlayer) Pause() *dbus.Error {
	if err := p.bridge.manager.Pause(); err != nil {
		return dbus.MakeFailedError(err)
	}
	return nil
}

func (p *mprisPlayer) PlayPause() *dbus.Error {
	if err := p.bridge.manager.TogglePause(); err != nil {
		return dbus.MakeFailedError(err)
	}
	return nil
}

func (p *mprisPlayer) Stop() *dbus.Error {
	if err := p.bridge.manager.Stop(); err != nil {
		return dbus.MakeFailedError(err)
	}
	return nil
}

func (p *mprisPlayer) Seek(offset int64) *dbus.Error {
	snapshot := p.bridge.manager.State.Copy()
	target := snapshot.PositionSec + (float64(offset) / 1_000_000)
	if target < 0 {
		target = 0
	}
	if err := p.bridge.manager.Seek(target); err != nil {
		return dbus.MakeFailedError(err)
	}
	return nil
}
