document.addEventListener('DOMContentLoaded', () => {
    const headerOutput = document.getElementById('header-output');
    const serviceList = document.getElementById('service-list');
    const input = document.getElementById('command-input');
    const hint = document.getElementById('command-hint');
    
    let services = []; 
    let filteredServices = [];
    let selectedIndex = 0;
    let activeCommand = null;
    let isPrivacyMode = false;
    let fuse = null; // Fuse instance

    const COMMANDS = ['refresh', 'help', 'clear', 'privacy', 'ping', 'screensaver', '?'];

    const DEFAULT_SCREENSAVER_TIMEOUT_MS = 60000;
    const SCREENSAVER_MIN_MS = 5000;
    const SCREENSAVER_MAX_MS = 60 * 60 * 1000;
    const DEFAULT_SCREENSAVER_SEED_PHASE_MS = 5000;
    const DEFAULT_SCREENSAVER_SPEED = 1.0;
    const SCREENSAVER_STORAGE_KEY = 'screensaverTimeoutMs';
    const SCREENSAVER_SPEED_STORAGE_KEY = 'screensaverSpeed';

    const screensaverCanvas = document.getElementById('screensaver');
    let screensaverTimeoutMs = DEFAULT_SCREENSAVER_TIMEOUT_MS;
    let screensaverSeedPhaseMs = DEFAULT_SCREENSAVER_SEED_PHASE_MS;
    let screensaverSpeed = DEFAULT_SCREENSAVER_SPEED;
    let screensaverTimer = null;
    let screensaverActive = false;
    let screensaverRaf = null;
    let matrixState = null;
    let lastActivityAt = 0;

    function printHeader(text, className = '') {
        const div = document.createElement('div');
        div.className = className;
        div.innerHTML = text;
        headerOutput.appendChild(div);
        headerOutput.scrollTop = headerOutput.scrollHeight;
        return div;
    }

    async function init() {
        printHeader('Caddy Terminal Dashboard v1.0', 'label');
        printHeader('Type <span style="color:#fff">help</span> or <span style="color:#fff">?</span> for commands.', 'label');

        try {
            const response = await fetch('/api/config');
            services = await response.json();
            
            // Initialize Fuse
            const options = {
                keys: ['name', 'domains', 'target'],
                threshold: 0.2, // Tightened further to 0.1
                ignoreLocation: true 
            };
            fuse = new Fuse(services, options);

            renderServices(services);
        } catch (e) {
            printHeader(`CONNECTION ERROR: ${e.message}`, 'error');
        }
        input.focus();
    }

    function renderServices(list) {
        serviceList.innerHTML = '';
        filteredServices = list;
        selectedIndex = 0; 
        if (list.length === 0) return;

        list.forEach((site, index) => {
            const div = document.createElement('div');
            // Check if it's a command to add special class
            const isCommand = site.type === 'command';
            div.className = 'service-item' + (index === 0 ? ' selected' : '') + (isCommand ? ' command' : '');
            
            const promptChar = isCommand ? '>' : '➜';

            // Handle Privacy Mode
            let displayUrlHtml = '';
            
            // Normalize domains to array if not already (for backward compatibility during migration)
            const domains = Array.isArray(site.domains) ? site.domains : (site.domain ? [site.domain] : []);
            
            if (!isCommand && isPrivacyMode) {
                 // Show "ServiceName.*" just once? Or "Beszel.* Monitor.*"
                 // Simplest is to just show Name.*
                 displayUrlHtml = '<span class="service-url">' + site.name.replace(/\s+/g, '') + '.*</span>';
            } else if (domains.length > 0) {
                 displayUrlHtml = domains.map(d => {
                     let href = `http://${d}`;
                     if (d === 'unknown') href = '#';
                     return `<a href="${href}" target="_self" class="service-url">${d}</a>`;
                 }).join(' '); // Space separated
            } else {
                 displayUrlHtml = '<span class="service-url">No Domain</span>';
            }

            div.innerHTML = `
                <span class="prompt-char">${promptChar}</span>
                <span class="service-name">${site.name}</span>
                <span class="domain-wrapper">${displayUrlHtml}</span>
                <span class="service-meta">[${site.target}]</span>
            `;
            serviceList.appendChild(div);
        });
    }

    function updateSelection() {
        const items = serviceList.children;
        if (items.length === 0) return;
        selectedIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));
        Array.from(items).forEach((item, i) => {
            item.classList.toggle('selected', i === selectedIndex);
            if (i === selectedIndex) item.scrollIntoView({ block: 'nearest' });
        });
    }

    function printResult(html) {
        serviceList.innerHTML = `<div class="result-output">${html}</div>`;
        filteredServices = []; // Clear selection context
        selectedIndex = -1;
    }

    function showHelp() {
        printResult(`
        <div class="label">
        <br><span style="color:#fff">COMMANDS:</span>
        <span style="color:#fff">refresh</span>  - Reload Caddyfile from disk
        <span style="color:#fff">ping</span>     - Check status of all services
        <span style="color:#fff">privacy</span>  - Toggle privacy mode (hide domains)
        <span style="color:#fff">screensaver</span> - Set timeout or speed (e.g. screensaver 90 / screensaver speed 0.6)
        <span style="color:#fff">clear</span>    - Clear terminal history
        <span style="color:#fff">help / ?</span>  - Show this menu
        <br><br><span style="color:#fff">HOTKEYS:</span>
        <span style="color:#fff">Arrows</span>   - Navigate services
        <span style="color:#fff">Enter</span>    - Open Service or Run Command
        </div>
        `);
    }

    function loadScreensaverTimeout() {
        const raw = localStorage.getItem(SCREENSAVER_STORAGE_KEY);
        const parsed = raw ? parseInt(raw, 10) : NaN;
        if (!Number.isNaN(parsed)) {
            screensaverTimeoutMs = Math.min(SCREENSAVER_MAX_MS, Math.max(SCREENSAVER_MIN_MS, parsed));
        }
    }

    function saveScreensaverTimeout(ms) {
        screensaverTimeoutMs = Math.min(SCREENSAVER_MAX_MS, Math.max(SCREENSAVER_MIN_MS, ms));
        localStorage.setItem(SCREENSAVER_STORAGE_KEY, String(screensaverTimeoutMs));
        scheduleScreensaver();
    }

    function loadScreensaverSpeed() {
        const raw = localStorage.getItem(SCREENSAVER_SPEED_STORAGE_KEY);
        const parsed = raw ? parseFloat(raw) : NaN;
        if (!Number.isNaN(parsed)) {
            screensaverSpeed = Math.min(5, Math.max(0.1, parsed));
        }
    }

    function saveScreensaverSpeed(mult) {
        screensaverSpeed = Math.min(5, Math.max(0.1, mult));
        localStorage.setItem(SCREENSAVER_SPEED_STORAGE_KEY, String(screensaverSpeed));
    }

    function scheduleScreensaver() {
        if (screensaverTimer) clearTimeout(screensaverTimer);
        screensaverTimer = setTimeout(startScreensaver, screensaverTimeoutMs);
    }

    function recordActivity() {
        const now = Date.now();
        if (now - lastActivityAt < 200) return;
        lastActivityAt = now;
        if (screensaverActive) {
            stopScreensaver();
        }
        scheduleScreensaver();
    }

    function startScreensaver() {
        if (screensaverActive) return;
        screensaverActive = true;
        document.body.classList.add('screensaver-active');
        initMatrix();
        animateMatrix();
    }

    function stopScreensaver() {
        if (!screensaverActive) return;
        screensaverActive = false;
        document.body.classList.remove('screensaver-active');
        if (screensaverRaf) cancelAnimationFrame(screensaverRaf);
        screensaverRaf = null;
        if (matrixState && matrixState.ctx) {
            matrixState.ctx.clearRect(0, 0, matrixState.width, matrixState.height);
        }
        matrixState = null;
    }

    function getSeedCharacters() {
        const text = document.querySelector('.terminal').innerText || '';
        const chars = [];
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (/[\x21-\x7E]/.test(ch)) chars.push(ch);
        }
        const unique = Array.from(new Set(chars));
        if (unique.length < 20) {
            return Array.from('CADDYTERM0123.:/-');
        }
        return unique;
    }

    function buildSeedGlyphs(ctx) {
        const terminal = document.querySelector('.terminal');
        if (!terminal) return null;

        const rect = terminal.getBoundingClientRect();
        const style = window.getComputedStyle(terminal);
        const fontSize = Math.max(12, parseFloat(style.fontSize) || 16);
        let lineHeight = parseFloat(style.lineHeight);
        if (Number.isNaN(lineHeight)) lineHeight = Math.round(fontSize * 1.2);
        lineHeight = Math.max(lineHeight, Math.round(fontSize * 1.1));

        ctx.font = `${fontSize}px VT323, monospace`;
        ctx.textBaseline = 'top';

        let seedLayer = document.getElementById('screensaver-seed');
        if (!seedLayer) {
            seedLayer = document.createElement('div');
            seedLayer.id = 'screensaver-seed';
            document.body.appendChild(seedLayer);
        }

        seedLayer.style.left = `${rect.left}px`;
        seedLayer.style.top = `${rect.top}px`;
        seedLayer.style.width = `${rect.width}px`;
        seedLayer.style.height = `${rect.height}px`;
        seedLayer.style.fontFamily = 'VT323, monospace';
        seedLayer.style.fontSize = `${fontSize}px`;
        seedLayer.style.lineHeight = `${lineHeight}px`;

        const lines = terminal.innerText.split('\n');
        const frag = document.createDocumentFragment();
        for (let r = 0; r < lines.length; r++) {
            const line = lines[r] || '';
            for (let c = 0; c < line.length; c++) {
                const span = document.createElement('span');
                const ch = line[c];
                span.textContent = ch === ' ' ? '\u00A0' : ch;
                frag.appendChild(span);
            }
            if (r < lines.length - 1) {
                frag.appendChild(document.createElement('br'));
            }
        }
        seedLayer.innerHTML = '';
        seedLayer.appendChild(frag);

        const glyphs = [];
        const spans = seedLayer.querySelectorAll('span');
        const maxGlyphs = 2500;
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            const ch = span.textContent;
            if (!/[\x21-\x7E]/.test(ch)) continue;
            const r = span.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            glyphs.push({
                ch,
                x: r.left,
                y: r.top,
                vy: (0.5 + Math.random() * 1.2) * screensaverSpeed
            });
            if (glyphs.length >= maxGlyphs) break;
        }

        if (glyphs.length < 40) {
            const fallback = getSeedCharacters();
            const count = 120;
            for (let i = 0; i < count; i++) {
                glyphs.push({
                    ch: fallback[Math.floor(Math.random() * fallback.length)],
                    x: rect.left + Math.random() * rect.width,
                    y: rect.top + Math.random() * rect.height,
                    vy: (0.5 + Math.random() * 1.2) * screensaverSpeed
                });
            }
        }

        return { glyphs, rect, fontSize, lineHeight };
    }

    function initMatrix() {
        const dpr = window.devicePixelRatio || 1;
        screensaverCanvas.width = Math.floor(window.innerWidth * dpr);
        screensaverCanvas.height = Math.floor(window.innerHeight * dpr);
        screensaverCanvas.style.width = `${window.innerWidth}px`;
        screensaverCanvas.style.height = `${window.innerHeight}px`;

        const ctx = screensaverCanvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const fontSize = Math.max(14, Math.min(20, Math.floor(window.innerWidth / 80)));
        const cols = Math.floor(window.innerWidth / fontSize);
        const seedGlyphs = buildSeedGlyphs(ctx);

        matrixState = {
            ctx,
            width: window.innerWidth,
            height: window.innerHeight,
            fontSize,
            cols,
            seedChars: getSeedCharacters(),
            seedGlyphs,
            phaseStart: performance.now(),
            lastSeedAt: performance.now()
        };
    }

    function animateMatrix() {
        if (!screensaverActive || !matrixState) return;
        const { ctx, width, height, seedGlyphs } = matrixState;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(0, 0, width, height);

        if (seedGlyphs && seedGlyphs.glyphs.length > 0) {
            ctx.fillStyle = '#00aa00';
            ctx.font = `${seedGlyphs.fontSize}px VT323, monospace`;
            const { glyphs, rect, lineHeight } = seedGlyphs;
            let activeCount = 0;
            for (let i = 0; i < glyphs.length; i++) {
                const g = glyphs[i];
                if (g.dead) continue;
                ctx.fillText(g.ch, g.x, g.y);
                g.y += g.vy;
                if (g.y > height + 20) {
                    g.dead = true;
                } else {
                    activeCount++;
                }
            }

            // Once everything has fallen off, re-seed from current screen
            if (activeCount === 0 && performance.now() - matrixState.lastSeedAt > 500) {
                matrixState.seedGlyphs = buildSeedGlyphs(ctx);
                matrixState.lastSeedAt = performance.now();
            }
        }

        screensaverRaf = requestAnimationFrame(animateMatrix);
    }

    function handleScreensaverCommand(rawInput) {
        const parts = rawInput.trim().split(/\s+/);
        if (parts.length < 2) {
            const current = Math.round(screensaverTimeoutMs / 1000);
            printResult(
                `<div class="label">Screensaver timeout: <span style="color:#fff">${current}s</span>` +
                `<br>Speed: <span style="color:#fff">${screensaverSpeed.toFixed(2)}x</span>` +
                `<br>Usage: screensaver [seconds]` +
                `<br>screensaver speed [multiplier]` +
                `<br>screensaver now</div>`
            );
            return;
        }
        const arg = parts[1].toLowerCase();
        if (arg === 'now' || arg === 'on') {
            startScreensaver();
            printResult('<div class="label">Screensaver started. Move mouse or press a key to exit.</div>');
            return;
        }
        if (arg === 'speed') {
            const mult = parseFloat(parts[2]);
            if (!Number.isFinite(mult) || mult <= 0) {
                printResult('<div class="error">Invalid speed. Use multiplier, e.g. screensaver speed 0.6</div>');
                return;
            }
            saveScreensaverSpeed(mult);
            printResult(`<div class="label">Screensaver speed set to <span style="color:#fff">${screensaverSpeed.toFixed(2)}x</span></div>`);
            return;
        }
        const seconds = parseFloat(arg);
        if (!Number.isFinite(seconds) || seconds <= 0) {
            printResult('<div class="error">Invalid timeout. Use seconds, e.g. screensaver 90</div>');
            return;
        }
        const ms = Math.round(seconds * 1000);
        saveScreensaverTimeout(ms);
        printResult(`<div class="label">Screensaver timeout set to <span style="color:#fff">${Math.round(screensaverTimeoutMs / 1000)}s</span></div>`);
    }

    input.addEventListener('input', (e) => {
        const val = e.target.value;
        const lowerVal = val.toLowerCase().trim();
        
        // Clear ghost hint
        hint.innerHTML = ''; 
        activeCommand = null;
        
        if (!lowerVal) {
             renderServices(services);
             return;
        }

        // Fuzzy Search Services
        let matchedServices = [];
        if (fuse) {
            const results = fuse.search(val);
            matchedServices = results.map(r => r.item);
        }

        // Filter Commands (Prefix match is still better for commands than fuzzy)
        const matchedCommands = [];
        if (lowerVal) {
            COMMANDS.forEach(cmd => {
                if (cmd.startsWith(lowerVal)) {
                    matchedCommands.push({
                        name: cmd,
                        domain: 'System Command',
                        target: 'EXEC',
                        type: 'command'
                    });
                }
            });
        }
        
        // If command match is strong (starts with), prioritize it in UI hint too
        // Check exact prefix match for ghost hint
        const exactCmdMatch = COMMANDS.find(cmd => cmd.startsWith(lowerVal));
        if (exactCmdMatch) {
             hint.innerHTML = `<span style="color:transparent">${val}</span> [${exactCmdMatch}]`;
             activeCommand = exactCmdMatch;
        }

        // Combine: Commands first, then services
        renderServices([...matchedCommands, ...matchedServices]);
    });

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex++;
            updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex--;
            updateSelection();
        } else if (e.key === 'Enter') {
            const rawInput = input.value.trim();
            const val = rawInput.toLowerCase();
            
            // Check if we have a selected item from the list (Command or Service)
            if (filteredServices.length > 0 && selectedIndex >= 0 && selectedIndex < filteredServices.length) {
                const selected = filteredServices[selectedIndex];
                
                if (selected.type === 'command') {
                    // Execute Command
                    const cmdToRun = selected.name;

                    if (cmdToRun === 'help' || cmdToRun === '?') {
                        showHelp();
                    } else if (cmdToRun === 'clear') {
                        headerOutput.innerHTML = '';
                    } else if (cmdToRun === 'refresh') {
                        printResult('<div class="label">Reloading configuration...</div>');
                        try {
                            const res = await fetch('/api/refresh', { method: 'POST' });
                            const result = await res.json();
                            services = result.data;
                            
                            // Re-init Fuse
                            const options = {
                                keys: ['name', 'domains', 'target'],
                                threshold: 0.1,
                                ignoreLocation: true
                            };
                            fuse = new Fuse(services, options);

                            printResult(`<div class="label">Done. ${services.length} services found.<br>Type to search.</div>`);
                            return; 
                        } catch (err) {
                            printResult('<div class="error">Error reloading config.</div>');
                            return;
                        }
                    } else if (cmdToRun === 'privacy') {
                        isPrivacyMode = !isPrivacyMode;
                        printResult(`<div class="label">Privacy Mode: <span style="color:#fff">${isPrivacyMode ? 'ON' : 'OFF'}</span></div>`);
                        return;
                    } else if (cmdToRun === 'screensaver') {
                        handleScreensaverCommand(rawInput);
                        return;
                    } else if (cmdToRun.startsWith('add ')) {
                         // add domain target
                         const parts = cmdToRun.split(/\s+/);
                         if (parts.length < 3) {
                             printResult('<div class="error">Usage: add [domain] [target]</div>');
                             return;
                         }
                         const domain = parts[1];
                         const target = parts[2];
                         printResult(`<div class="label">Adding ${domain} -> ${target}...</div>`);
                         
                         try {
                             const res = await fetch('/api/add', {
                                 method: 'POST',
                                 headers: { 'Content-Type': 'application/json' },
                                 body: JSON.stringify({ domain, target })
                             });
                             const result = await res.json();
                             if (result.success) {
                                 printResult(`<div class="label" style="color:#00ff00">${result.message}</div>`);
                                 // Auto refresh
                                 const refreshRes = await fetch('/api/refresh', { method: 'POST' });
                                 const refreshData = await refreshRes.json();
                                 services = refreshData.data;
                             } else {
                                 printResult(`<div class="error">Error: ${result.error}</div>`);
                             }
                         } catch (e) {
                             printResult(`<div class="error">Connection Error</div>`);
                         }
                         return;

                    } else if (cmdToRun.startsWith('del ')) {
                         const parts = cmdToRun.split(/\s+/);
                         if (parts.length < 2) {
                             printResult('<div class="error">Usage: del [domain]</div>');
                             return;
                         }
                         const domain = parts[1];
                         printResult(`<div class="label">Deleting ${domain}...</div>`);

                         try {
                             const res = await fetch('/api/delete', {
                                 method: 'POST',
                                 headers: { 'Content-Type': 'application/json' },
                                 body: JSON.stringify({ domain })
                             });
                             const result = await res.json();
                             if (result.success) {
                                 printResult(`<div class="label" style="color:#00ff00">${result.message}</div>`);
                                 // Auto refresh
                                 const refreshRes = await fetch('/api/refresh', { method: 'POST' });
                                 const refreshData = await refreshRes.json();
                                 services = refreshData.data;
                             } else {
                                 printResult(`<div class="error">Error: ${result.error}</div>`);
                             }
                         } catch (e) {
                             printResult(`<div class="error">Connection Error</div>`);
                         }
                         return;

                    } else if (cmdToRun === 'ping') {
                        printResult('<div class="label">Pinging services...</div>');
                        try {
                            const res = await fetch('/api/ping');
                            const results = await res.json();
                            
                            let output = '<table style="width:100%; text-align:left;">';
                            results.forEach(r => {
                                const statusColor = r.status === 'online' ? '#00ff00' : '#ff0000';
                                const statusText = r.status.toUpperCase();
                                const latency = r.latency ? `${r.latency}ms` : '-';
                                output += `<tr>
                                    <td style="color:${statusColor}">[${statusText}]</td>
                                    <td>${r.name}</td>
                                    <td style="opacity:0.6">${r.target}</td>
                                    <td style="text-align:right">${latency}</td>
                                </tr>`;
                            });
                            output += '</table><br><div class="label">Ping complete.</div>';
                            printResult(output);
                        } catch (err) {
                            printResult('<div class="error">Ping failed.</div>');
                        }
                        return;
                    }
                    // Reset
                    input.value = '';
                    // If command was help/refresh, we already updated the view. 
                    // Only re-render if it was something else or we want to reset immediately?
                    // Actually, for help/refresh we want the result to stay until user types again.
                    return; 
                } else {
                    // Open Service
                    const domains = Array.isArray(selected.domains) ? selected.domains : (selected.domain ? [selected.domain] : []);
                    if (domains.length > 0 && domains[0] !== 'unknown') {
                        window.open(`http://${domains[0]}`, '_self');
                        input.value = '';
                        renderServices(services);
                    }
                }
            } else if (val.startsWith('screensaver')) {
                handleScreensaverCommand(rawInput);
            }
        }
    });

    // Keep focus on input (Desktop convenience), but allow interaction on mobile
    // We only force focus if the user clicks on the "terminal" background, not on links
    document.addEventListener('click', (e) => {
        // If clicking a link or the input itself, do nothing
        if (e.target.tagName === 'A' || e.target === input) return;
        
        // Check if text is selected (user might be copying IP), don't focus then
        if (window.getSelection().toString().length > 0) return;

        // On mobile, avoiding aggressive focus to prevent keyboard popping up while scrolling
        if (window.innerWidth > 768) {
             input.focus();
        }
    });

    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'].forEach(evt => {
        document.addEventListener(evt, recordActivity, { passive: true });
    });

    window.addEventListener('resize', () => {
        if (screensaverActive) initMatrix();
    });

    init();
    loadScreensaverTimeout();
    loadScreensaverSpeed();
    scheduleScreensaver();
});
