package proxyutil

import (
	"bufio"
	"context"
	cryptotls "crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"

	"golang.org/x/net/proxy"
)

// Mode describes how a proxy setting should be interpreted.
type Mode int

const (
	// ModeInherit means no explicit proxy behavior was configured.
	ModeInherit Mode = iota
	// ModeDirect means outbound requests must bypass proxies explicitly.
	ModeDirect
	// ModeProxy means a concrete proxy URL was configured.
	ModeProxy
	// ModeInvalid means the proxy setting is present but malformed or unsupported.
	ModeInvalid
)

// Setting is the normalized interpretation of a proxy configuration value.
type Setting struct {
	Raw  string
	Mode Mode
	URL  *url.URL
}

// Parse normalizes a proxy configuration value into inherit, direct, or proxy modes.
func Parse(raw string) (Setting, error) {
	trimmed := strings.TrimSpace(raw)
	setting := Setting{Raw: trimmed}

	if trimmed == "" {
		setting.Mode = ModeInherit
		return setting, nil
	}

	if strings.EqualFold(trimmed, "direct") || strings.EqualFold(trimmed, "none") {
		setting.Mode = ModeDirect
		return setting, nil
	}

	parsedURL, errParse := url.Parse(trimmed)
	if errParse != nil {
		setting.Mode = ModeInvalid
		return setting, fmt.Errorf("parse proxy URL failed: %w", errParse)
	}
	if parsedURL.Scheme == "" || parsedURL.Host == "" {
		setting.Mode = ModeInvalid
		return setting, fmt.Errorf("proxy URL missing scheme/host")
	}

	switch parsedURL.Scheme {
	case "socks5", "socks5h", "http", "https":
		setting.Mode = ModeProxy
		setting.URL = parsedURL
		return setting, nil
	default:
		setting.Mode = ModeInvalid
		return setting, fmt.Errorf("unsupported proxy scheme: %s", parsedURL.Scheme)
	}
}

func cloneDefaultTransport() *http.Transport {
	if transport, ok := http.DefaultTransport.(*http.Transport); ok && transport != nil {
		return transport.Clone()
	}
	return &http.Transport{}
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) {
	return c.reader.Read(p)
}

type httpConnectDialer struct {
	proxyURL *url.URL
	forward  proxy.Dialer
}

func newHTTPConnectDialer(proxyURL *url.URL, forward proxy.Dialer) proxy.Dialer {
	return &httpConnectDialer{
		proxyURL: proxyURL,
		forward:  forward,
	}
}

func proxyAddress(proxyURL *url.URL) string {
	if proxyURL == nil {
		return ""
	}
	if port := proxyURL.Port(); port != "" {
		return proxyURL.Host
	}
	switch strings.ToLower(proxyURL.Scheme) {
	case "https":
		return net.JoinHostPort(proxyURL.Hostname(), "443")
	default:
		return net.JoinHostPort(proxyURL.Hostname(), "80")
	}
}

func (d *httpConnectDialer) Dial(network, addr string) (net.Conn, error) {
	if network == "" {
		network = "tcp"
	}
	if !strings.HasPrefix(network, "tcp") {
		return nil, fmt.Errorf("HTTP CONNECT proxy only supports TCP, got %q", network)
	}

	proxyConn, errDial := d.forward.Dial("tcp", proxyAddress(d.proxyURL))
	if errDial != nil {
		return nil, fmt.Errorf("dial proxy failed: %w", errDial)
	}

	conn := proxyConn
	if strings.EqualFold(d.proxyURL.Scheme, "https") {
		tlsConn := cryptotls.Client(proxyConn, &cryptotls.Config{
			ServerName: d.proxyURL.Hostname(),
			MinVersion: cryptotls.VersionTLS12,
		})
		if errHandshake := tlsConn.Handshake(); errHandshake != nil {
			proxyConn.Close()
			return nil, fmt.Errorf("proxy TLS handshake failed: %w", errHandshake)
		}
		conn = tlsConn
	}

	if errWrite := writeConnectRequest(conn, d.proxyURL, addr); errWrite != nil {
		conn.Close()
		return nil, errWrite
	}

	reader := bufio.NewReader(conn)
	resp, errResponse := http.ReadResponse(reader, &http.Request{Method: http.MethodConnect})
	if errResponse != nil {
		conn.Close()
		return nil, fmt.Errorf("read proxy CONNECT response failed: %w", errResponse)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		conn.Close()
		detail := strings.TrimSpace(string(body))
		if detail != "" {
			return nil, fmt.Errorf("proxy CONNECT failed: %s: %s", resp.Status, detail)
		}
		return nil, fmt.Errorf("proxy CONNECT failed: %s", resp.Status)
	}

	if reader.Buffered() > 0 {
		return &bufferedConn{Conn: conn, reader: reader}, nil
	}
	return conn, nil
}

func writeConnectRequest(conn net.Conn, proxyURL *url.URL, addr string) error {
	var builder strings.Builder
	builder.Grow(128)
	builder.WriteString("CONNECT ")
	builder.WriteString(addr)
	builder.WriteString(" HTTP/1.1\r\nHost: ")
	builder.WriteString(addr)
	builder.WriteString("\r\n")

	if proxyURL != nil && proxyURL.User != nil {
		username := proxyURL.User.Username()
		password, _ := proxyURL.User.Password()
		credentials := base64.StdEncoding.EncodeToString([]byte(username + ":" + password))
		builder.WriteString("Proxy-Authorization: Basic ")
		builder.WriteString(credentials)
		builder.WriteString("\r\n")
	}

	builder.WriteString("User-Agent: Go-http-client/1.1\r\n\r\n")

	if _, errWrite := io.WriteString(conn, builder.String()); errWrite != nil {
		return fmt.Errorf("write proxy CONNECT request failed: %w", errWrite)
	}
	return nil
}

// NewDirectTransport returns a transport that bypasses environment proxies.
func NewDirectTransport() *http.Transport {
	clone := cloneDefaultTransport()
	clone.Proxy = nil
	return clone
}

// BuildHTTPTransport constructs an HTTP transport for the provided proxy setting.
func BuildHTTPTransport(raw string) (*http.Transport, Mode, error) {
	setting, errParse := Parse(raw)
	if errParse != nil {
		return nil, setting.Mode, errParse
	}

	switch setting.Mode {
	case ModeInherit:
		return nil, setting.Mode, nil
	case ModeDirect:
		return NewDirectTransport(), setting.Mode, nil
	case ModeProxy:
		if setting.URL.Scheme == "socks5" || setting.URL.Scheme == "socks5h" {
			var proxyAuth *proxy.Auth
			if setting.URL.User != nil {
				username := setting.URL.User.Username()
				password, _ := setting.URL.User.Password()
				proxyAuth = &proxy.Auth{User: username, Password: password}
			}
			dialer, errSOCKS5 := proxy.SOCKS5("tcp", setting.URL.Host, proxyAuth, proxy.Direct)
			if errSOCKS5 != nil {
				return nil, setting.Mode, fmt.Errorf("create SOCKS5 dialer failed: %w", errSOCKS5)
			}
			transport := cloneDefaultTransport()
			transport.Proxy = nil
			transport.DialContext = func(_ context.Context, network, addr string) (net.Conn, error) {
				return dialer.Dial(network, addr)
			}
			return transport, setting.Mode, nil
		}
		transport := cloneDefaultTransport()
		transport.Proxy = http.ProxyURL(setting.URL)
		return transport, setting.Mode, nil
	default:
		return nil, setting.Mode, nil
	}
}

// BuildDialer constructs a proxy dialer for settings that operate at the connection layer.
func BuildDialer(raw string) (proxy.Dialer, Mode, error) {
	setting, errParse := Parse(raw)
	if errParse != nil {
		return nil, setting.Mode, errParse
	}

	switch setting.Mode {
	case ModeInherit:
		return nil, setting.Mode, nil
	case ModeDirect:
		return proxy.Direct, setting.Mode, nil
	case ModeProxy:
		switch strings.ToLower(setting.URL.Scheme) {
		case "http", "https":
			return newHTTPConnectDialer(setting.URL, proxy.Direct), setting.Mode, nil
		}
		dialer, errDialer := proxy.FromURL(setting.URL, proxy.Direct)
		if errDialer != nil {
			return nil, setting.Mode, fmt.Errorf("create proxy dialer failed: %w", errDialer)
		}
		return dialer, setting.Mode, nil
	default:
		return nil, setting.Mode, nil
	}
}
