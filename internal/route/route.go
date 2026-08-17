// Package route decides, per destination, whether traffic goes through the
// tunnel, straight out, or nowhere at all.
//
// Routing is not a luxury on a circumvention proxy. Sending every packet
// through the tunnel is slow for domestic traffic and, more importantly, makes
// the tunnel carry a volume of traffic that stands out. Sending local and
// domestic destinations direct keeps the tunnel small and its traffic pattern
// closer to ordinary browsing.
package route

import (
	"fmt"
	"net"
	"net/netip"
	"strings"
)

// Decision is the outcome of matching a destination against the rules.
type Decision int

// Possible decisions.
const (
	Proxy  Decision = iota // send through the tunnel
	Direct                 // connect from this machine
	Block                  // refuse
)

// String renders the decision for logs.
func (d Decision) String() string {
	switch d {
	case Direct:
		return "direct"
	case Block:
		return "block"
	default:
		return "proxy"
	}
}

// privateRanges are the destinations that must never be tunnelled by default:
// loopback, the RFC1918 LAN blocks, link-local (which includes the cloud
// metadata address 169.254.169.254), and their IPv6 equivalents.
var privateRanges = []string{
	"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
	"169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16", "224.0.0.0/4",
	"255.255.255.255/32",
	"::1/128", "fc00::/7", "fe80::/10", "ff00::/8",
}

// Router matches destinations against a rule set.
type Router struct {
	directDomains domainSet
	blockDomains  domainSet
	directNets    []netip.Prefix
	blockNets     []netip.Prefix
	private       []netip.Prefix
	final         Decision
}

// domainSet matches a domain against suffix rules and exact rules.
type domainSet struct {
	suffix map[string]bool // "example.com" matches example.com and *.example.com
	exact  map[string]bool // "full:example.com" matches only example.com
}

func newDomainSet() domainSet {
	return domainSet{suffix: map[string]bool{}, exact: map[string]bool{}}
}

func (d domainSet) add(rule string) {
	if strings.HasPrefix(rule, "full:") {
		d.exact[strings.ToLower(strings.TrimPrefix(rule, "full:"))] = true
		return
	}
	d.suffix[strings.ToLower(strings.TrimPrefix(rule, "domain:"))] = true
}

// match walks the domain's parent labels so that one rule covers a whole zone
// without needing a wildcard entry per subdomain.
func (d domainSet) match(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if d.exact[host] {
		return true
	}
	for {
		if d.suffix[host] {
			return true
		}
		i := strings.IndexByte(host, '.')
		if i < 0 {
			return false
		}
		host = host[i+1:]
	}
}

func (d domainSet) empty() bool { return len(d.suffix) == 0 && len(d.exact) == 0 }

// New builds a Router. Rules are domain suffixes, "full:" exact domains, CIDR
// blocks, or bare IPs; anything else is a configuration error rather than a
// silently dropped rule.
func New(direct, block []string, bypassPrivate bool, final Decision) (*Router, error) {
	r := &Router{
		directDomains: newDomainSet(),
		blockDomains:  newDomainSet(),
		final:         final,
	}
	if err := r.load(direct, &r.directNets, r.directDomains, "route.direct"); err != nil {
		return nil, err
	}
	if err := r.load(block, &r.blockNets, r.blockDomains, "route.block"); err != nil {
		return nil, err
	}
	if bypassPrivate {
		for _, s := range privateRanges {
			p, err := netip.ParsePrefix(s)
			if err != nil {
				return nil, fmt.Errorf("route: bad builtin prefix %q: %w", s, err)
			}
			r.private = append(r.private, p)
		}
	}
	return r, nil
}

func (r *Router) load(rules []string, nets *[]netip.Prefix, domains domainSet, what string) error {
	for _, rule := range rules {
		rule = strings.TrimSpace(rule)
		if rule == "" || strings.HasPrefix(rule, "#") {
			continue
		}
		switch {
		case strings.HasPrefix(rule, "full:"), strings.HasPrefix(rule, "domain:"):
			domains.add(rule)
		case strings.Contains(rule, "/"):
			p, err := netip.ParsePrefix(strings.TrimPrefix(rule, "ip:"))
			if err != nil {
				return fmt.Errorf("%s: bad CIDR %q: %w", what, rule, err)
			}
			*nets = append(*nets, p.Masked())
		default:
			if addr, err := netip.ParseAddr(rule); err == nil {
				*nets = append(*nets, netip.PrefixFrom(addr, addr.BitLen()))
				continue
			}
			domains.add(rule)
		}
	}
	return nil
}

// Match decides what to do with a destination. host may be a domain or a
// literal IP.
//
// A domain is matched against domain rules only; it is deliberately not
// resolved first. Resolving it here would put a DNS query for every censored
// hostname onto the local network, which defeats the point of tunnelling it.
func (r *Router) Match(host string) Decision {
	if addr, err := netip.ParseAddr(host); err == nil {
		addr = addr.Unmap()
		if matchNets(r.private, addr) {
			return Direct
		}
		if matchNets(r.blockNets, addr) {
			return Block
		}
		if matchNets(r.directNets, addr) {
			return Direct
		}
		return r.final
	}
	if r.blockDomains.match(host) {
		return Block
	}
	if r.directDomains.match(host) {
		return Direct
	}
	// "localhost" and friends resolve into private space; keep them local.
	if host == "localhost" || strings.HasSuffix(host, ".localhost") ||
		strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		if len(r.private) > 0 {
			return Direct
		}
	}
	return r.final
}

func matchNets(nets []netip.Prefix, addr netip.Addr) bool {
	for _, p := range nets {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

// IsPrivateHost reports whether a resolved IP falls in a range that should
// never leave this machine. The server uses it to refuse requests that would
// turn the proxy into a probe of its own private network -- including the
// cloud metadata endpoint, which is the usual way a naive proxy leaks its
// host's credentials.
func IsPrivateHost(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true
	}
	addr = addr.Unmap()
	for _, s := range privateRanges {
		p, err := netip.ParsePrefix(s)
		if err != nil {
			continue
		}
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

// ParseDecision converts a config string into a Decision.
func ParseDecision(s string) (Decision, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "proxy":
		return Proxy, nil
	case "direct":
		return Direct, nil
	case "block":
		return Block, nil
	default:
		return Proxy, fmt.Errorf("route: unknown decision %q", s)
	}
}

// Summary describes the loaded rules for the startup log.
func (r *Router) Summary() string {
	return fmt.Sprintf("direct=%d domains/%d nets block=%d domains/%d nets private-bypass=%t final=%s",
		len(r.directDomains.suffix)+len(r.directDomains.exact), len(r.directNets),
		len(r.blockDomains.suffix)+len(r.blockDomains.exact), len(r.blockNets),
		len(r.private) > 0, r.final)
}

// HasRules reports whether any user rule was configured.
func (r *Router) HasRules() bool {
	return !r.directDomains.empty() || !r.blockDomains.empty() ||
		len(r.directNets) > 0 || len(r.blockNets) > 0
}
