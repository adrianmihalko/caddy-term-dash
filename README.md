# Caddy Terminal Dashboard

A futuristic, terminal-style dashboard for your Caddy reverse proxy services. It parses your `Caddyfile` on the fly and presents your services in a beautiful, retro CLI interface.

## Features

*   **Live Caddyfile Parsing:** Automatically detects your services.
*   **Terminal Aesthetic:** Retro CRT scanlines, glow effects, and monospace typography.
*   **Keyboard Navigation:** Use Arrow keys and Enter to launch services.
*   **Command System:**
    *   `ping` - Check online status of all services.
    *   `privacy` - Mask domains for screenshots.
    *   `refresh` - Reload configuration.
*   **Fuzzy Search:** Quickly find services by name, domain, or IP.
*   **Mobile Ready:** Fully responsive design for phone usage.

## Installation

### 1. Docker (Recommended)

```bash
docker run -d \
  --name caddy-dash \
  -p 3000:3000 \
  -v /etc/caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
  ghcr.io/adrianmihalko/caddy-term-dash:latest
```

### 2. Manual

```bash
git clone https://github.com/adrianmihalko/caddy-term-dash.git
cd caddy-term-dash
npm install
CADDYFILE_PATH=/path/to/your/Caddyfile node server.js
```

## Configuration

*   **Names:** Add comments above your Caddyfile blocks to name them.
    ```caddy
    # Plex Media Server
    plex.home.lan {
        reverse_proxy 192.168.1.10:32400
    }
    ```
*   **Multiple Domains:**
    ```caddy
    # Monitoring
    grafana.home.lan, prometheus.home.lan {
        reverse_proxy 192.168.1.50:3000
    }
    ```

## License

ISC
