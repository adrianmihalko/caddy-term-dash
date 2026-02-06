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

    const COMMANDS = ['refresh', 'help', 'clear', 'privacy', 'ping', '?'];

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
        <span style="color:#fff">clear</span>    - Clear terminal history
        <span style="color:#fff">help / ?</span>  - Show this menu
        <br><br><span style="color:#fff">HOTKEYS:</span>
        <span style="color:#fff">Arrows</span>   - Navigate services
        <span style="color:#fff">Enter</span>    - Open Service or Run Command
        </div>
        `);
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
            const val = input.value.trim().toLowerCase();
            
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
            } else if (val === 'refresh') {
                // Fallback for exact typing if list is empty for some reason, though logic above covers it
                 // ... (Optional redundancy)
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

    init();
});
