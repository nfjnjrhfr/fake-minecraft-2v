package protocol

import (
	"bytes"
	"io"
	"net"
	"strings"
	"testing"
)

func TestTokenIsStableAndDistinct(t *testing.T) {
	a := Token("correct horse battery staple")
	if len(a) != AuthLen {
		t.Fatalf("token length = %d, want %d", len(a), AuthLen)
	}
	if !TokenEqual(a, Token("correct horse battery staple")) {
		t.Error("same password produced different tokens")
	}
	if TokenEqual(a, Token("correct horse battery stapl")) {
		t.Error("different passwords produced the same token")
	}
	// The token must not be a bare SHA-256 of the password, so that a leaked
	// hash from some unrelated database is not directly usable here.
	if string(a) == "af9cd0b1c4b3a0c78b57ffdbd0e3a0f7e57bfa4dd0d3ad0f38e2c6c33d5b1e6f" {
		t.Error("token looks like an undomain-separated hash")
	}
}

func TestAddrRoundTrip(t *testing.T) {
	for _, in := range []string{
		"example.com:443",
		"1.2.3.4:80",
		"[2001:db8::1]:8080",
		"a.very.long.subdomain.chain.example.org:65535",
	} {
		t.Run(in, func(t *testing.T) {
			addr, err := ParseAddr(in)
			if err != nil {
				t.Fatalf("ParseAddr(%q): %v", in, err)
			}
			encoded := addr.AppendTo(nil)
			decoded, err := ReadAddr(bytes.NewReader(encoded))
			if err != nil {
				t.Fatalf("ReadAddr: %v", err)
			}
			if got := decoded.String(); got != in {
				t.Errorf("round trip = %q, want %q", got, in)
			}
		})
	}
}

func TestParseAddrRejectsGarbage(t *testing.T) {
	for _, in := range []string{
		"no-port",
		"example.com:notaport",
		"example.com:99999",
		":80",
		strings.Repeat("x", 300) + ":80",
	} {
		if _, err := ParseAddr(in); err == nil {
			t.Errorf("ParseAddr(%q) accepted an invalid address", in)
		}
	}
}

func TestRequestRoundTrip(t *testing.T) {
	token := Token("hunter2hunter2")
	target, err := ParseAddr("example.com:443")
	if err != nil {
		t.Fatal(err)
	}
	frame, err := EncodeRequest(token, Request{Command: CmdConnect, Target: target})
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("GET / HTTP/1.1\r\n\r\n")
	r := bytes.NewReader(append(frame, payload...))

	got, consumed, err := ReadAuth(r)
	if err != nil {
		t.Fatalf("ReadAuth: %v", err)
	}
	if !TokenEqual(got, token) {
		t.Error("token did not survive the round trip")
	}
	if len(consumed) != AuthLen+2 {
		t.Errorf("consumed %d bytes, want %d", len(consumed), AuthLen+2)
	}

	req, err := ReadRequestBody(r)
	if err != nil {
		t.Fatalf("ReadRequestBody: %v", err)
	}
	if req.Command != CmdConnect {
		t.Errorf("command = %#x, want %#x", req.Command, CmdConnect)
	}
	if got := req.Target.String(); got != "example.com:443" {
		t.Errorf("target = %q, want example.com:443", got)
	}

	// Everything after the header must be untouched payload.
	rest, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(rest, payload) {
		t.Errorf("payload = %q, want %q", rest, payload)
	}
}

// TestRequestPaddingVaries guards the anti-fingerprinting property: two
// requests to the same destination must not produce identical bytes, or the
// first record of every session would have a fixed, matchable length.
func TestRequestPaddingVaries(t *testing.T) {
	token := Token("hunter2hunter2")
	target, _ := ParseAddr("example.com:443")

	lengths := map[int]bool{}
	for i := 0; i < 32; i++ {
		frame, err := EncodeRequest(token, Request{Command: CmdConnect, Target: target})
		if err != nil {
			t.Fatal(err)
		}
		lengths[len(frame)] = true
	}
	if len(lengths) < 8 {
		t.Errorf("only %d distinct header lengths in 32 requests; padding is not varying", len(lengths))
	}
}

// TestReadAuthReturnsConsumedBytes covers the probe-resistance path: whatever
// a non-client sent must come back so the server can replay it to the fallback
// site instead of hanging up.
func TestReadAuthReturnsConsumedBytes(t *testing.T) {
	probe := []byte("GET / HTTP/1.1\r\nHost: example.com\r\nUser-Agent: curl/8.0\r\n\r\n")
	_, consumed, err := ReadAuth(bytes.NewReader(probe))
	if err == nil {
		t.Fatal("expected an error for a non-veil request")
	}
	if !bytes.HasPrefix(probe, consumed) {
		t.Errorf("consumed bytes %q are not a prefix of what was sent", consumed)
	}

	// A short read must also report what it managed to take.
	short := []byte("hello")
	_, consumed, err = ReadAuth(bytes.NewReader(short))
	if err == nil {
		t.Fatal("expected an error for a truncated request")
	}
	if !bytes.Equal(consumed, short) {
		t.Errorf("consumed = %q, want %q", consumed, short)
	}
}

func TestReadRequestBodyRejectsBadCommand(t *testing.T) {
	target, _ := ParseAddr("1.2.3.4:80")
	body := []byte{0x99}
	body = target.AppendTo(body)
	body = append(body, 0, '\r', '\n')

	if _, err := ReadRequestBody(bytes.NewReader(body)); err == nil {
		t.Error("accepted an unknown command")
	}
}

func TestDatagramRoundTrip(t *testing.T) {
	addr, _ := ParseAddr("8.8.8.8:53")
	payload := bytes.Repeat([]byte{0xAB}, 512)

	var stream []byte
	stream = Datagram{Addr: addr, Payload: payload}.AppendTo(stream)
	stream = Datagram{Addr: addr, Payload: []byte("second")}.AppendTo(stream)

	r := bytes.NewReader(stream)
	buf := make([]byte, MaxDatagram)

	first, err := ReadDatagram(r, buf)
	if err != nil {
		t.Fatalf("ReadDatagram: %v", err)
	}
	if !bytes.Equal(first.Payload, payload) {
		t.Error("first datagram payload was corrupted")
	}
	if first.Addr.String() != "8.8.8.8:53" {
		t.Errorf("addr = %q, want 8.8.8.8:53", first.Addr.String())
	}

	second, err := ReadDatagram(r, buf)
	if err != nil {
		t.Fatalf("ReadDatagram (second): %v", err)
	}
	if string(second.Payload) != "second" {
		t.Errorf("second payload = %q", second.Payload)
	}
}

func TestReadDatagramRejectsOversizedFrame(t *testing.T) {
	addr, _ := ParseAddr("8.8.8.8:53")
	frame := Datagram{Addr: addr, Payload: bytes.Repeat([]byte{1}, 4096)}.AppendTo(nil)

	if _, err := ReadDatagram(bytes.NewReader(frame), make([]byte, 1024)); err != ErrTooLarge {
		t.Errorf("err = %v, want ErrTooLarge", err)
	}
}

func TestAddrHostnameSkipsPort(t *testing.T) {
	domain, _ := ParseAddr("example.com:443")
	if got := domain.Hostname(); got != "example.com" {
		t.Errorf("Hostname() = %q", got)
	}
	v6, _ := ParseAddr("[2001:db8::1]:443")
	if got := v6.Hostname(); got != net.ParseIP("2001:db8::1").String() {
		t.Errorf("Hostname() = %q", got)
	}
}
