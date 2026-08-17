package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestSingleServerFormStillWorks protects existing configs: the original
// "server" object must keep working after the list form was introduced.
func TestSingleServerFormStillWorks(t *testing.T) {
	path := writeConfig(t, `{
		"listen": "127.0.0.1:1080",
		"server": {"address": "example.com:443", "password": "long-enough-password"}
	}`)

	var c Client
	if err := Load(path, &c); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(c.Servers) != 1 {
		t.Fatalf("got %d servers, want 1", len(c.Servers))
	}
	s := c.Servers[0]
	if s.Address != "example.com:443" {
		t.Errorf("address = %q", s.Address)
	}
	if s.SNI != "example.com" {
		t.Errorf("sni = %q, want it defaulted from the address", s.SNI)
	}
	if s.Fingerprint != "chrome" {
		t.Errorf("fingerprint = %q, want chrome", s.Fingerprint)
	}
	if s.ID == "" {
		t.Error("id was not derived")
	}
}

func TestServerListIsAccepted(t *testing.T) {
	path := writeConfig(t, `{
		"servers": [
			{"name": "Japan - Tokyo", "country": "JP", "address": "jp.example.com:443", "password": "long-enough-password"},
			{"id": "us", "name": "United States", "address": "us.example.com:443", "password": "another-long-password"}
		],
		"auto_connect": "us"
	}`)

	var c Client
	if err := Load(path, &c); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(c.Servers) != 2 {
		t.Fatalf("got %d servers, want 2", len(c.Servers))
	}
	if c.Servers[0].ID != "japan-tokyo" {
		t.Errorf("derived id = %q, want japan-tokyo", c.Servers[0].ID)
	}
	if c.Servers[1].ID != "us" {
		t.Errorf("explicit id = %q, want us", c.Servers[1].ID)
	}
	if c.Web.Listen != "127.0.0.1:8088" {
		t.Errorf("console default = %q", c.Web.Listen)
	}
	if !c.Web.EnabledOr(true) {
		t.Error("the console should be on by default")
	}
}

func TestBothServerFormsCombine(t *testing.T) {
	path := writeConfig(t, `{
		"server": {"name": "Primary", "address": "one.example.com:443", "password": "long-enough-password"},
		"servers": [{"name": "Backup", "address": "two.example.com:443", "password": "another-long-password"}]
	}`)

	var c Client
	if err := Load(path, &c); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(c.Servers) != 2 {
		t.Fatalf("got %d servers, want 2", len(c.Servers))
	}
	// The single-server entry leads, so it stays the natural default.
	if c.Servers[0].Name != "Primary" {
		t.Errorf("first server = %q, want Primary", c.Servers[0].Name)
	}
}

func TestWhenDisconnectedDefaultsToBlock(t *testing.T) {
	path := writeConfig(t, `{
		"server": {"address": "example.com:443", "password": "long-enough-password"}
	}`)

	var c Client
	if err := Load(path, &c); err != nil {
		t.Fatal(err)
	}
	// Failing closed is the safe default; a silent direct fallback would look
	// like success to the application while leaking.
	if c.WhenDisconnected != "block" {
		t.Errorf("when_disconnected = %q, want block", c.WhenDisconnected)
	}
}

func TestInvalidClientConfigsAreRejected(t *testing.T) {
	cases := map[string]string{
		"no servers":             `{"listen": "127.0.0.1:1080"}`,
		"missing password":       `{"server": {"address": "example.com:443"}}`,
		"address without a port": `{"server": {"address": "example.com", "password": "long-enough-password"}}`,
		"duplicate ids": `{"servers": [
			{"id": "a", "address": "one.example.com:443", "password": "long-enough-password"},
			{"id": "a", "address": "two.example.com:443", "password": "another-long-password"}]}`,
		"auto_connect names nothing": `{
			"server": {"address": "example.com:443", "password": "long-enough-password"},
			"auto_connect": "missing"}`,
		"bad when_disconnected": `{
			"server": {"address": "example.com:443", "password": "long-enough-password"},
			"when_disconnected": "maybe"}`,
		"pin and allow_insecure together": `{"server": {
			"address": "example.com:443", "password": "long-enough-password",
			"pin": "abc", "allow_insecure": true}}`,
		"unknown field": `{"server": {"address": "example.com:443", "password": "long-enough-password"}, "typo": 1}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			var c Client
			if err := Load(writeConfig(t, body), &c); err == nil {
				t.Error("invalid configuration was accepted")
			}
		})
	}
}

func TestInvalidServerConfigsAreRejected(t *testing.T) {
	cases := map[string]string{
		"no users":                `{"tls": {"cert": "c", "key": "k"}, "fallback": "127.0.0.1:8080"}`,
		"short password":          `{"users": [{"password": "short"}], "tls": {"cert": "c", "key": "k"}, "fallback": "127.0.0.1:8080"}`,
		"no fallback":             `{"users": [{"password": "long-enough-password"}], "tls": {"cert": "c", "key": "k"}}`,
		"no tls":                  `{"users": [{"password": "long-enough-password"}], "fallback": "127.0.0.1:8080"}`,
		"shared passwords":        `{"users": [{"name":"a","password": "long-enough-password"},{"name":"b","password": "long-enough-password"}], "tls": {"cert": "c", "key": "k"}, "fallback": "127.0.0.1:8080"}`,
		"fallback without a port": `{"users": [{"password": "long-enough-password"}], "tls": {"cert": "c", "key": "k"}, "fallback": "127.0.0.1"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			var s Server
			if err := Load(writeConfig(t, body), &s); err == nil {
				t.Error("invalid configuration was accepted")
			}
		})
	}
}

func TestServerALPNDefaultsToWhatADecoyCanSpeak(t *testing.T) {
	path := writeConfig(t, `{
		"users": [{"password": "long-enough-password"}],
		"tls": {"cert": "c", "key": "k"},
		"fallback": "127.0.0.1:8080"
	}`)

	var s Server
	if err := Load(path, &s); err != nil {
		t.Fatal(err)
	}
	// Advertising h2 while the decoy speaks HTTP/1.1 breaks every probe in a
	// way real websites do not, so the default must stay http/1.1 only.
	if len(s.ALPN) != 1 || s.ALPN[0] != "http/1.1" {
		t.Errorf("alpn = %v, want [http/1.1]", s.ALPN)
	}
}

func TestDurationAcceptsStringsAndNumbers(t *testing.T) {
	var d struct {
		A Duration `json:"a"`
		B Duration `json:"b"`
	}
	if err := json.Unmarshal([]byte(`{"a": "90s", "b": 45}`), &d); err != nil {
		t.Fatal(err)
	}
	if time.Duration(d.A) != 90*time.Second {
		t.Errorf("a = %v, want 90s", time.Duration(d.A))
	}
	if time.Duration(d.B) != 45*time.Second {
		t.Errorf("b = %v, want 45s", time.Duration(d.B))
	}
	if got := Duration(0).Or(time.Minute); got != time.Minute {
		t.Errorf("Or on an unset duration = %v", got)
	}
}

func TestSlugDerivation(t *testing.T) {
	for in, want := range map[string]string{
		"Japan - Tokyo":     "japan-tokyo",
		"  United States  ": "united-states",
		"日本 Tokyo 01":       "tokyo-01",
		"!!!":               "",
	} {
		if got := slug(in); got != want {
			t.Errorf("slug(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestUnknownFieldsAreRejected matters for a security tool: a typo in a
// setting like allow_insecure must be an error, not a silently ignored key
// that leaves the safe default in place without telling anyone.
func TestUnknownFieldsAreRejected(t *testing.T) {
	path := writeConfig(t, `{
		"server": {"address": "example.com:443", "password": "long-enough-password", "allow_insecur": true}
	}`)

	var c Client
	err := Load(path, &c)
	if err == nil {
		t.Fatal("a misspelled field was accepted")
	}
	if !strings.Contains(err.Error(), "allow_insecur") {
		t.Errorf("error does not name the offending field: %v", err)
	}
}
