package player

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var anime4KShaders = map[string]string{
	"anime4k-medium.glsl": `//!HOOK MAIN
//!BIND HOOKED
//!DESC Nipah Anime4K Medium

vec4 hook() {
	vec2 pt = HOOKED_pt;
	vec4 c = HOOKED_tex(HOOKED_pos);
	vec4 n = HOOKED_tex(HOOKED_pos + vec2(0.0, -pt.y));
	vec4 s = HOOKED_tex(HOOKED_pos + vec2(0.0, pt.y));
	vec4 e = HOOKED_tex(HOOKED_pos + vec2(pt.x, 0.0));
	vec4 w = HOOKED_tex(HOOKED_pos + vec2(-pt.x, 0.0));
	vec4 sharpened = c + (c * 4.0 - (n + s + e + w)) * 0.10;
	return clamp(sharpened, 0.0, 1.0);
}
`,
	"anime4k-high.glsl": `//!HOOK MAIN
//!BIND HOOKED
//!DESC Nipah Anime4K High

vec4 hook() {
	vec2 pt = HOOKED_pt;
	vec4 c = HOOKED_tex(HOOKED_pos);
	vec4 n = HOOKED_tex(HOOKED_pos + vec2(0.0, -pt.y));
	vec4 s = HOOKED_tex(HOOKED_pos + vec2(0.0, pt.y));
	vec4 e = HOOKED_tex(HOOKED_pos + vec2(pt.x, 0.0));
	vec4 w = HOOKED_tex(HOOKED_pos + vec2(-pt.x, 0.0));
	vec4 ne = HOOKED_tex(HOOKED_pos + vec2(pt.x, -pt.y));
	vec4 nw = HOOKED_tex(HOOKED_pos + vec2(-pt.x, -pt.y));
	vec4 se = HOOKED_tex(HOOKED_pos + vec2(pt.x, pt.y));
	vec4 sw = HOOKED_tex(HOOKED_pos + vec2(-pt.x, pt.y));
	vec4 edge = (c * 8.0 - (n + s + e + w + ne + nw + se + sw)) * 0.08;
	return clamp(c + edge, 0.0, 1.0);
}
`,
}

var anime4KOnce sync.Once
var anime4KDir string
var anime4KErr error

func anime4KShaderArgs(level string) []string {
	level = strings.ToLower(strings.TrimSpace(level))
	if level == "" || level == "off" {
		return nil
	}

	dir, err := ensureAnime4KShaders()
	if err != nil {
		return nil
	}

	files := []string{}
	switch level {
	case "medium":
		files = []string{"anime4k-medium.glsl"}
	case "high":
		files = []string{"anime4k-medium.glsl", "anime4k-high.glsl"}
	default:
		return nil
	}

	args := make([]string, 0, len(files))
	for _, name := range files {
		args = append(args, fmt.Sprintf("--glsl-shaders-append=%s", filepath.Join(dir, name)))
	}
	return args
}

func ensureAnime4KShaders() (string, error) {
	anime4KOnce.Do(func() {
		configDir, err := os.UserConfigDir()
		if err != nil {
			anime4KErr = err
			return
		}
		dir := filepath.Join(configDir, "Nipah", "shaders")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			anime4KErr = err
			return
		}
		for name, contents := range anime4KShaders {
			target := filepath.Join(dir, name)
			if err := os.WriteFile(target, []byte(contents), 0o644); err != nil {
				anime4KErr = err
				return
			}
		}
		anime4KDir = dir
	})
	return anime4KDir, anime4KErr
}
