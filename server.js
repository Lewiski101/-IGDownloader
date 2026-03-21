const express = require('express');
const axios   = require('axios');
const path    = require('path');
const { spawn, execFile } = require('child_process');
const fs      = require('fs');
const app     = express();
const port    = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── CORS ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── yt-dlp binary path ───────────────────────────────────────────
const localBin = path.join(__dirname, 'yt-dlp.exe');
const YT_DLP_BIN = fs.existsSync(localBin) ? localBin : 'yt-dlp';
console.log(`[ENGINE] Using yt-dlp binary: ${YT_DLP_BIN}`);

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
};

// ════════════════════════════════════════════════════════════════
//  GET /thumb?url=...  — proxy thumbnail
// ════════════════════════════════════════════════════════════════
app.get('/thumb', async (req, res) => {
  const imgUrl = req.query.url;
  if (!imgUrl) return res.status(400).send('Missing url');
  try {
    const r = await axios({ url: imgUrl, method: 'GET', responseType: 'stream',
      timeout: 15000,
      headers: { ...BROWSER_HEADERS, Referer: 'https://www.instagram.com/' }
    });
    res.setHeader('Content-Type', r.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    r.data.pipe(res);
  } catch (err) {
    const px = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.send(px);
  }
});

/** Run yt-dlp with given args, return stdout string */
function runYtdlp(args) {
    return new Promise((resolve, reject) => {
        console.log(`[ENGINE] Executing: ${YT_DLP_BIN} ${args.join(' ')}`);
        execFile(YT_DLP_BIN, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`[ENGINE ERROR] code: ${error.code}, signal: ${error.signal}`);
                console.error(`[ENGINE STDERR] ${stderr}`);
                return reject(new Error(stderr || error.message));
            }
            resolve(stdout);
        });
    });
}

// ════════════════════════════════════════════════════════════════
//  GET /info?url=...  — use yt-dlp to get EVERYTHING (clean metadata)
// ════════════════════════════════════════════════════════════════
app.get('/info', async (req, res) => {
  const videoUrl = req.query.url;
  console.log(`[INFO] Fetching ${videoUrl} ...`);

  if (!videoUrl) return res.status(400).json({ error: 'Missing URL' });
  if (!videoUrl.includes('instagram.com'))
    return res.status(400).json({ error: 'Please enter a valid Instagram URL' });

  try {
    // ── 1. Fetch metadata using yt-dlp ──────────────────────────
    const args = [
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificate',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        '--referer', 'https://www.instagram.com/',
        '-j',
        videoUrl
    ];
    const jsonStr = await runYtdlp(args);
    const d = JSON.parse(jsonStr);

    if (!d) throw new Error('Failed to parse metadata');

    // ── Better Title Logic ──
    const author   = (d.uploader || d.channel || 'instagram').replace(/^@/, '');
    
    // Sometimes 'description' contains the real caption while 'title' is just the username
    let rawTitle = (d.title || d.description || '').trim();
    
    // If title is just the username (with or without @), it's a "no-title" case
    const isGeneric = !rawTitle || 
                      rawTitle.toLowerCase() === author.toLowerCase() || 
                      rawTitle.toLowerCase() === `@${author.toLowerCase()}`;

    let title = rawTitle.split('\n')[0].trim();

    // If generic, use the fallback
    if (isGeneric || title.toLowerCase().startsWith('video by ')) {
        title = `Video by @${author}`;
    }

    // ── Creator Toolkit Data ──
    const fullCaption = (d.description || d.title || '').trim();

    // Limit Title length for display/filename
    if (title.length > 150) title = title.substring(0, 147) + '...';

    // Proxy the thumbnail so it displays
    const thumbUrl = d.thumbnail || d.thumbnails?.[0]?.url || d.thumbnails?.reverse()?.find(t => t.url)?.url || null;
    const proxiedThumb = thumbUrl ? `/thumb?url=${encodeURIComponent(thumbUrl)}` : null;

    return res.json({
        title,
        caption:   fullCaption,
        thumbnail: proxiedThumb,
        rawThumb:  thumbUrl,
        author:    `@${author.replace(/^@/, '')}`,
        videoUrl:  req.query.url // Always pass the original Post URL for streaming
    });

  } catch (err) {
    console.error('[INFO ERROR]', err.message);
    return res.status(500).json({ error: 'Could not fetch video info. Make sure the post is public and the link is correct.' });
  }
});

// ════════════════════════════════════════════════════════════════
//  GET /download?url=...&title=...  — Proxy-stream via yt-dlp
// ════════════════════════════════════════════════════════════════
app.get('/download', async (req, res) => {
  const { url: videoUrl, title = 'instagram_video' } = req.query;
  if (!videoUrl) return res.status(400).send('Missing URL');

  try {
    const filename = title.replace(/[^a-z0-9 .\-_]/gi, '_').substring(0, 100) + '.mp4';
    console.log(`[DOWNLOAD] Streaming ${filename} via yt-dlp...`);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const args = [
        '--no-playlist',
        '--no-check-certificate',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        '--referer', 'https://www.instagram.com/',
        '-f', 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
        '--merge-output-format', 'mp4',
        '-o', '-',
        videoUrl
    ];

    console.log(`[DOWNLOAD] Spawning: ${YT_DLP_BIN} ${args.join(' ')}`);
    const child = spawn(YT_DLP_BIN, args);

    child.stdout.pipe(res);

    child.stderr.on('data', (data) => console.log(`[yt-dlp log] ${data}`));

    child.on('error', (err) => {
        console.error('[SPAWN ERROR]', err.message);
        if (!res.headersSent) res.status(500).end();
    });

    child.on('close', (code) => {
        console.log(`[DOWNLOAD] Completed with code ${code}`);
        res.end();
    });

    // Kill process if client disconnects
    req.on('close', () => {
        child.kill();
    });

  } catch (err) {
    console.error('[DOWNLOAD ERROR]', err.message);
    if (!res.headersSent) res.status(500).send('Failed to download.');
  }
});

// ════════════════════════════════════════════════════════════════
//  GET /download-thumb?url=...  — Proxy thumbnail as attachment
// ════════════════════════════════════════════════════════════════
app.get('/download-thumb', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing URL');

    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        res.setHeader('Content-Disposition', 'attachment; filename="instagram_thumbnail.jpg"');
        res.setHeader('Content-Type', 'image/jpeg');
        response.data.pipe(res);
    } catch (err) {
        console.error('[THUMB DOWNLOAD ERROR]', err.message);
        res.status(500).send('Failed to download thumbnail.');
    }
});

app.listen(port, () =>
  console.log(`🚀 IGDownloader running at http://localhost:${port}`)
);
