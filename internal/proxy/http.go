package proxy

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"

	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/protocol"
	"github.com/nfjnjrhfr/fake-minecraft-2v/internal/relay"
)

// hopByHopHeaders are meaningful only between adjacent peers and must not be
// passed along. Proxy-Connection is not in RFC 7230 but is still emitted by
// older clients, and forwarding it confuses some origin servers.
var hopByHopHeaders = []string{
	"Connection", "Proxy-Connection", "Keep-Alive", "Proxy-Authenticate",
	"Proxy-Authorization", "Te", "Trailer", "Transfer-Encoding", "Upgrade",
}

// handleHTTP serves an application speaking the HTTP proxy protocol: CONNECT
// for TLS, and absolute-URI requests for plain HTTP.
func (s *Server) handleHTTP(ctx context.Context, conn net.Conn, br *bufio.Reader) error {
	var (
		upstream     net.Conn
		upstreamHost string
	)
	defer func() {
		if upstream != nil {
			upstream.Close()
		}
	}()

	for {
		req, err := http.ReadRequest(br)
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, net.ErrClosed) {
				return nil
			}
			return err
		}

		if req.Method == http.MethodConnect {
			// CONNECT consumes the connection: after the 200 there is no more
			// HTTP framing to parse, only bytes.
			return s.httpConnect(ctx, conn, br, req)
		}

		target, err := targetFromRequest(req)
		if err != nil {
			writeHTTPError(conn, req, http.StatusBadRequest, err.Error())
			return err
		}

		// Reuse the upstream connection while the client keeps asking for the
		// same origin, which is what keep-alive is for; redial when it moves.
		if upstream != nil && upstreamHost != target.String() {
			upstream.Close()
			upstream = nil
		}
		if upstream == nil {
			upstream, err = s.dialer.Dial(ctx, target)
			if err != nil {
				writeHTTPError(conn, req, statusFor(err), err.Error())
				return fmt.Errorf("http: connect %s: %w", target, err)
			}
			upstreamHost = target.String()
		}

		resp, err := roundTrip(upstream, req)
		if err != nil {
			writeHTTPError(conn, req, http.StatusBadGateway, err.Error())
			upstream.Close()
			upstream = nil
			return fmt.Errorf("http: %s %s: %w", req.Method, target, err)
		}

		closeAfter := resp.Close || req.Close || resp.ProtoMajor == 1 && resp.ProtoMinor == 0
		if err := resp.Write(conn); err != nil {
			resp.Body.Close()
			return err
		}
		resp.Body.Close()

		if closeAfter {
			return nil
		}
	}
}

// httpConnect answers a CONNECT request and then hands the connection over to
// the relay.
func (s *Server) httpConnect(ctx context.Context, conn net.Conn, br *bufio.Reader, req *http.Request) error {
	target, err := protocol.ParseAddr(hostWithPort(req.Host, "443"))
	if err != nil {
		writeHTTPError(conn, req, http.StatusBadRequest, err.Error())
		return err
	}

	remote, err := s.dialer.Dial(ctx, target)
	if err != nil {
		writeHTTPError(conn, req, statusFor(err), err.Error())
		return fmt.Errorf("http: connect %s: %w", target, err)
	}
	defer remote.Close()

	if _, err := io.WriteString(conn, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return err
	}

	// A pipelining client may already have sent TLS bytes that landed in the
	// buffered reader. Flush them before relaying or the handshake stalls.
	if n := br.Buffered(); n > 0 {
		if _, err := io.CopyN(remote, br, int64(n)); err != nil {
			return err
		}
	}
	return relay.Pipe(conn, remote, s.idle)
}

// roundTrip forwards one plain-HTTP request upstream and reads the response.
func roundTrip(upstream net.Conn, req *http.Request) (*http.Response, error) {
	outbound := req.Clone(req.Context())
	for _, h := range hopByHopHeaders {
		outbound.Header.Del(h)
	}
	// Anything listed in Connection is hop-by-hop for this message too.
	for _, v := range req.Header.Values("Connection") {
		for _, name := range strings.Split(v, ",") {
			if name = strings.TrimSpace(name); name != "" {
				outbound.Header.Del(name)
			}
		}
	}
	outbound.Close = false

	if err := outbound.Write(upstream); err != nil {
		return nil, err
	}
	resp, err := http.ReadResponse(bufio.NewReader(upstream), outbound)
	if err != nil {
		return nil, err
	}
	for _, h := range hopByHopHeaders {
		resp.Header.Del(h)
	}
	return resp, nil
}

// targetFromRequest extracts the origin from an absolute-URI proxy request.
func targetFromRequest(req *http.Request) (protocol.Addr, error) {
	host := req.URL.Host
	if host == "" {
		host = req.Host
	}
	if host == "" {
		return protocol.Addr{}, errors.New("proxy request has no destination")
	}
	if req.URL.Scheme != "" && req.URL.Scheme != "http" {
		return protocol.Addr{}, fmt.Errorf("unsupported scheme %q", req.URL.Scheme)
	}
	return protocol.ParseAddr(hostWithPort(host, "80"))
}

// hostWithPort appends a default port when the authority omits one.
func hostWithPort(host, defaultPort string) string {
	if host == "" {
		return ""
	}
	if _, _, err := net.SplitHostPort(host); err == nil {
		return host
	}
	// A bare IPv6 literal needs brackets before a port can be appended.
	if strings.Count(host, ":") >= 2 && !strings.HasPrefix(host, "[") {
		return "[" + host + "]:" + defaultPort
	}
	return net.JoinHostPort(host, defaultPort)
}

// writeHTTPError reports a failure to the application in its own protocol.
func writeHTTPError(conn net.Conn, req *http.Request, status int, detail string) {
	resp := &http.Response{
		StatusCode: status,
		Proto:      "HTTP/1.1",
		ProtoMajor: 1,
		ProtoMinor: 1,
		Header:     http.Header{},
		Close:      true,
		Request:    req,
	}
	body := fmt.Sprintf("%d %s\n%s\n", status, http.StatusText(status), detail)
	resp.Body = io.NopCloser(strings.NewReader(body))
	resp.ContentLength = int64(len(body))
	resp.Header.Set("Content-Type", "text/plain; charset=utf-8")
	resp.Write(conn)
}

// statusFor maps a dial failure onto an HTTP status, keeping "refused by
// policy" distinguishable from "the site is down".
func statusFor(err error) int {
	var blocked *ErrBlocked
	if errors.As(err, &blocked) {
		return http.StatusForbidden
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return http.StatusGatewayTimeout
	}
	return http.StatusBadGateway
}
