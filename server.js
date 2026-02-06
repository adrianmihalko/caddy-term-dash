const express = require('express');
const fs = require('fs');
const path = require('path');
const net = require('net');
const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Serve static files
app.use(express.static('public'));

// Helper: Parse Caddyfile and Save to DB
function parseAndSaveCaddyfile() {
    return new Promise((resolve, reject) => {
        const caddyfilePath = process.env.CADDYFILE_PATH || path.join(__dirname, 'Caddyfile');

        console.log(`[System] Reading Caddyfile from: ${caddyfilePath}`);

        if (!fs.existsSync(caddyfilePath)) {
            console.error('[Error] Caddyfile not found');
            return reject('Caddyfile not found');
        }

        fs.readFile(caddyfilePath, 'utf8', (err, data) => {
            if (err) return reject(err);

            const sites = [];
            const lines = data.split('\n');
            
            let lastComment = null;
            let currentBlock = null; 
            let matchers = {}; 

            const cleanName = (str) => {
                // Remove @ if present
                let name = str.startsWith('@') ? str.slice(1) : str;
                // Handle paths or domains by taking the first relevant part or cleaning dashes
                name = name.split(/[./]/)[0]; 
                return name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');
            };

            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                
                if (line.startsWith('#')) {
                    const commentText = line.slice(1).trim();
                    // Skip separator comments or section headers containing dashes
                    if (commentText.includes('---') || commentText.length < 2) {
                        // Keep current lastComment if it was valid, or just skip
                    } else {
                        lastComment = commentText;
                    }
                    continue;
                }

                if (!line) continue;

                // Capture Matchers
                // Regex: start with @, word/dashes, host, then capture everything else as domains
                const matcherMatch = line.match(/^@([\w-]+)\s+host\s+(.+)/);
                if (matcherMatch) {
                    // Split by whitespace to get multiple domains
                    const domains = matcherMatch[2].trim().split(/\s+/);
                    matchers[matcherMatch[1]] = domains; // Store as array
                }

                // Block Start
                if (line.endsWith('{')) {
                    const blockHeader = line.slice(0, -1).trim();
                    const handleMatch = blockHeader.match(/^handle\s+@([\w-]+)/);
                    
                    if (handleMatch) {
                        const handleName = handleMatch[1];
                        // Get domains array or fallback
                        let domains = matchers[handleName] || ['unknown'];
                        // If it was stored as string previously (legacy safety), wrap it
                        if (typeof domains === 'string') domains = [domains];

                        currentBlock = {
                            type: 'handle',
                            name: lastComment || cleanName(handleName),
                            matcherRef: handleName,
                            domains: domains, 
                            target: null
                        };
                    } else {
                        // Handle comma-separated domains
                        const domains = blockHeader.split(',').map(d => d.trim());
                        currentBlock = {
                            type: 'domain',
                            name: lastComment, // Name might be derived per domain later if null
                            domains: domains,
                            target: null
                        };
                    }
                    
                    lastComment = null;
                    continue;
                }

                // Closing Block
                if (line === '}') {
                    if (currentBlock && currentBlock.target) {
                        
                        let finalDomains = [];
                        currentBlock.domains.forEach(d => {
                             // Fix unknown domains for handles if we found them later
                             if (currentBlock.type === 'handle' && d === 'unknown' && matchers[currentBlock.matcherRef]) {
                                 const m = matchers[currentBlock.matcherRef];
                                 if (Array.isArray(m)) {
                                     finalDomains.push(...m);
                                 } else {
                                     finalDomains.push(m);
                                 }
                             } else {
                                 finalDomains.push(d);
                             }
                        });
                        
                        // Deduplicate
                        finalDomains = [...new Set(finalDomains)];

                        let siteName = currentBlock.name;
                        if (!siteName && finalDomains.length > 0) {
                             siteName = cleanName(finalDomains[0].split('.')[0]); 
                        }

                        sites.push({
                            name: siteName,
                            domains: finalDomains,
                            target: currentBlock.target
                        });
                    }
                    currentBlock = null;
                    continue;
                }

                // Reverse Proxy Directive
                if (currentBlock && line.startsWith('reverse_proxy')) {
                    const parts = line.split(/\s+/);
                    // parts[0] is 'reverse_proxy'
                    // Take parts[1] as the target. 
                    // If parts[1] is a matcher (unlikely inside handle?), we might need parts[2].
                    // But usually it's the upstream. 
                    // Clean it of any trailing '{' or comments
                    let target = parts[1];
                    if (target && target !== '{') {
                        currentBlock.target = target;
                    }
                }
            }

            // Sort alphabetically by name
            sites.sort((a, b) => a.name.localeCompare(b.name));

            // Save to DB file
            fs.writeFile(DB_FILE, JSON.stringify(sites, null, 2), (err) => {
                if (err) return reject(err);
                console.log(`[System] Database updated. ${sites.length} services found.`);
                resolve(sites);
            });
        });
    });
}

// Helper: TCP Ping
function tcpPing(target) {
    return new Promise((resolve) => {
        // Clean target: remove protocol schemes like http://, https://, h2c://
        let cleanTarget = target.replace(/^[a-zA-Z0-9+.-]+:\/\//, '');
        
        // Split host and port
        let [host, port] = cleanTarget.split(':');
        
        // If no port found in string
        if (!port) {
             if (target.startsWith('https://')) port = 443;
             else port = 80;
        }

        // Clean port of any non-numeric chars (just in case)
        port = parseInt(port);
        
        console.log(`[Ping] Pinging ${host}:${port} (Raw: ${target})...`);

        const start = Date.now();
        const socket = new net.Socket();
        
        socket.setTimeout(5000); 

        socket.on('connect', () => {
            const duration = Date.now() - start;
            console.log(`[Ping] ${host}:${port} ONLINE (${duration}ms)`);
            socket.destroy();
            resolve({ status: 'online', latency: duration });
        });

        socket.on('timeout', () => {
            console.log(`[Ping] ${host}:${port} TIMEOUT`);
            socket.destroy();
            resolve({ status: 'timeout', latency: null });
        });

        socket.on('error', (err) => {
            console.log(`[Ping] ${host}:${port} ERROR: ${err.message}`);
            socket.destroy();
            resolve({ status: 'offline', error: err.code, latency: null });
        });

        socket.connect(port, host);
    });
}

// API to get config from Database
app.get('/api/config', (req, res) => {
    if (fs.existsSync(DB_FILE)) {
        fs.readFile(DB_FILE, 'utf8', (err, data) => {
            if (err) return res.status(500).json({ error: 'Failed to read database' });
            res.json(JSON.parse(data));
        });
    } else {
        // Fallback if DB doesn't exist yet
        parseAndSaveCaddyfile()
            .then(data => res.json(data))
            .catch(err => res.status(500).json({ error: err.toString() }));
    }
});

// API to Refresh Config
app.post('/api/refresh', (req, res) => {
    parseAndSaveCaddyfile()
        .then(data => res.json({ success: true, count: data.length, data: data }))
        .catch(err => res.status(500).json({ error: err.toString() }));
});

// API to Ping Services
app.get('/api/ping', (req, res) => {
    if (!fs.existsSync(DB_FILE)) {
        return res.status(500).json({ error: 'Database not ready' });
    }

    fs.readFile(DB_FILE, 'utf8', async (err, data) => {
        if (err) return res.status(500).json({ error: 'Failed to read database' });
        
        const sites = JSON.parse(data);
        const results = [];

        // Run pings in parallel
        const promises = sites.map(async (site) => {
            if (!site.target) {
                return { name: site.name, target: 'N/A', status: 'skipped', latency: 0 };
            }
            const result = await tcpPing(site.target);
            return { 
                name: site.name, 
                target: site.target, 
                status: result.status, 
                latency: result.latency 
            };
        });

        const pingResults = await Promise.all(promises);
        res.json(pingResults);
    });
});

// Initialize DB on Start
parseAndSaveCaddyfile().catch(err => console.error('[Warning] Initial parse failed:', err));

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
