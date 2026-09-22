import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchAndProcessTsetmc } from './collector.js';

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

const DATA_DIR = path.resolve('data');
const LATEST_FILE = path.join(DATA_DIR, 'latest.json');
const STATUS_FILE = path.join(DATA_DIR, 'status.json');

app.use(express.json());

// Handle /api/options.php and /api/options
app.get(['/api/options.php', '/api/options'], async (req, res) => {
    try {
        let stats;
        try {
            stats = await fs.stat(LATEST_FILE);
        } catch {
            return res.status(503).json({
                ok: false,
                message: 'داده آماده نیست',
                retry_in: 5
            });
        }

        const etag = `"${Math.floor(stats.mtimeMs)}"`;
        res.setHeader('Cache-Control', 'public, max-age=15');
        res.setHeader('ETag', etag);

        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }

        const raw = await fs.readFile(LATEST_FILE, 'utf-8');
        const payload = JSON.parse(raw);

        const age = Math.floor(Date.now() / 1000) - (payload.meta?.updated_ts || 0);
        if (age > 300 && payload.meta) {
            payload.meta.stale = true;
        }

        try {
            const statusRaw = await fs.readFile(STATUS_FILE, 'utf-8');
            const status = JSON.parse(statusRaw);
            if (payload.meta) {
                payload.meta.collector = status;
            }
        } catch {}

        res.json(payload);
    } catch (err) {
        console.error('Error serving options:', err);
        res.status(500).json({ ok: false, message: 'Invalid JSON or internal error' });
    }
});

// Handle /api/force_update.php and /api/force_update
app.all(['/api/force_update.php', '/api/force_update'], async (req, res) => {
    try {
        const result = await fetchAndProcessTsetmc();
        res.json(result);
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// Serve static assets
app.use('/assets', express.static(path.resolve('assets')));
app.use('/data', express.static(path.resolve('data')));

app.get('/', (req, res) => {
    res.sendFile(path.resolve('index.html'));
});

// Fallback to static root
app.use(express.static(path.resolve('.')));

app.listen(PORT, HOST, () => {
    console.log(`Options Dashboard server running on http://${HOST}:${PORT}`);
});
