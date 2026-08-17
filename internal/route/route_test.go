package route

import (
	"net"
	"testing"
)

func TestMatchDomainRules(t *testing.T) {
	r, err := New(
		[]string{"example.com", "full:only.test", "cn"},
		[]string{"ads.example.net"},
		true, Proxy,
	)
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		host string
		want Decision
	}{
		{"example.com", Direct},      // exact match on a suffix rule
		{"www.example.com", Direct},  // subdomain covered by the same rule
		{"notexample.com", Proxy},    // must not match on a bare substring
		{"only.test", Direct},        // full: matches exactly
		{"sub.only.test", Proxy},     // ...and not its subdomains
		{"weibo.cn", Direct},         // a TLD rule covers the whole zone
		{"ads.example.net", Block},   // block wins
		{"a.ads.example.net", Block}, // including subdomains
		{"example.net", Proxy},       // parent of a blocked zone is unaffected
		{"google.com", Proxy},        // default
		{"EXAMPLE.COM", Direct},      // matching is case insensitive
		{"www.example.com.", Direct}, // a trailing root dot is still the same name
	}
	for _, c := range cases {
		if got := r.Match(c.host); got != c.want {
			t.Errorf("Match(%q) = %v, want %v", c.host, got, c.want)
		}
	}
}

func TestMatchIPRules(t *testing.T) {
	r, err := New(
		[]string{"10.20.0.0/16", "203.0.113.7"},
		[]string{"198.51.100.0/24"},
		true, Proxy,
	)
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		host string
		want Decision
	}{
		{"10.20.30.40", Direct},
		{"203.0.113.7", Direct},
		{"203.0.113.8", Proxy},
		{"198.51.100.5", Block},
		{"8.8.8.8", Proxy},
		// Private space bypasses the tunnel regardless of the other rules.
		{"127.0.0.1", Direct},
		{"192.168.1.1", Direct},
		{"169.254.169.254", Direct},
		{"::1", Direct},
		{"fe80::1", Direct},
	}
	for _, c := range cases {
		if got := r.Match(c.host); got != c.want {
			t.Errorf("Match(%q) = %v, want %v", c.host, got, c.want)
		}
	}
}

// TestPrivateBypassCanBeDisabled matters because the end-to-end tests, and
// anyone tunnelling to their own LAN, depend on it.
func TestPrivateBypassCanBeDisabled(t *testing.T) {
	r, err := New(nil, nil, false, Proxy)
	if err != nil {
		t.Fatal(err)
	}
	if got := r.Match("127.0.0.1"); got != Proxy {
		t.Errorf("Match(127.0.0.1) = %v, want Proxy when the bypass is off", got)
	}
}

func TestFinalDecisionApplies(t *testing.T) {
	r, err := New([]string{"example.com"}, nil, true, Direct)
	if err != nil {
		t.Fatal(err)
	}
	if got := r.Match("unlisted.test"); got != Direct {
		t.Errorf("Match with final=direct = %v, want Direct", got)
	}
}

// TestDomainsAreNotResolved is the privacy-critical case: matching a domain
// must never trigger a DNS lookup, since that lookup would travel over exactly
// the network the tunnel exists to avoid.
func TestDomainsAreNotResolved(t *testing.T) {
	r, err := New(nil, nil, true, Proxy)
	if err != nil {
		t.Fatal(err)
	}
	// A name that cannot resolve must still be routed, not error or stall.
	if got := r.Match("this-name-does-not-exist.invalid"); got != Proxy {
		t.Errorf("Match on an unresolvable name = %v, want Proxy", got)
	}
}

func TestLocalNamesStayLocal(t *testing.T) {
	r, err := New(nil, nil, true, Proxy)
	if err != nil {
		t.Fatal(err)
	}
	for _, host := range []string{"localhost", "printer.local", "db.internal"} {
		if got := r.Match(host); got != Direct {
			t.Errorf("Match(%q) = %v, want Direct", host, got)
		}
	}
}

func TestBadRulesAreRejected(t *testing.T) {
	if _, err := New([]string{"10.0.0.0/64"}, nil, true, Proxy); err == nil {
		t.Error("accepted an impossible CIDR")
	}
	if _, err := New(nil, []string{"1.2.3.4/33"}, true, Proxy); err == nil {
		t.Error("accepted an impossible CIDR in the block list")
	}
}

func TestIsPrivateHost(t *testing.T) {
	private := []string{"127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.1",
		"169.254.169.254", "::1", "fe80::1", "fc00::1", "100.64.0.1"}
	for _, s := range private {
		if !IsPrivateHost(net.ParseIP(s)) {
			t.Errorf("IsPrivateHost(%q) = false, want true", s)
		}
	}
	public := []string{"8.8.8.8", "1.1.1.1", "203.0.113.1", "2001:db8::1"}
	for _, s := range public {
		if IsPrivateHost(net.ParseIP(s)) {
			t.Errorf("IsPrivateHost(%q) = true, want false", s)
		}
	}
	// An unparseable address is treated as private: refusing to connect is the
	// safe outcome when we cannot tell where we would be connecting.
	if !IsPrivateHost(nil) {
		t.Error("IsPrivateHost(nil) = false, want true")
	}
}

func TestParseDecision(t *testing.T) {
	for in, want := range map[string]Decision{
		"": Proxy, "proxy": Proxy, "DIRECT": Direct, " block ": Block,
	} {
		got, err := ParseDecision(in)
		if err != nil {
			t.Fatalf("ParseDecision(%q): %v", in, err)
		}
		if got != want {
			t.Errorf("ParseDecision(%q) = %v, want %v", in, got, want)
		}
	}
	if _, err := ParseDecision("sideways"); err == nil {
		t.Error("accepted an unknown decision")
	}
}
