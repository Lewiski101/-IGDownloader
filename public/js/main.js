// ─────────────────────────────────────────────────────────────
// IGDownloader — main.js
// Shared logic for Downloader, Titles, Captions, and Thumbnails
// ─────────────────────────────────────────────────────────────

const form           = document.getElementById('downloadForm');
const urlInput       = document.getElementById('videoUrl');
const pasteBtn       = document.getElementById('pasteBtn');
const submitBtn      = document.getElementById('submitBtn');
const loader         = document.getElementById('loader');
const errorMsg       = document.getElementById('errorMsg');
const resultOuter    = document.getElementById('resultOuter');
const resultThumb    = document.getElementById('resultThumb');
const resultTitle    = document.getElementById('resultTitle');
const resultCaptText = document.getElementById('resultCaptionDisplay');
const authorHandle   = document.getElementById('authorHandle');
const dlMp4Btn       = document.getElementById('dlMp4Btn');
const scrollTopBtn   = document.getElementById('scrollTopBtn');
const toolkitBox     = document.getElementById('creatorToolkit');
const thumbDlLinks   = document.querySelectorAll('[id*="thumbDlLink"], [id*="thumbPlainLink"]');

// State
let currentCaption = "";
let currentTitle   = "";

// ── Paste ─────────────────────────────────────────────────────
if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            urlInput.value = text;
            urlInput.focus();
        } catch {
            urlInput.focus();
        }
    });
}

// ── Submit ────────────────────────────────────────────────────
if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = urlInput.value.trim();

        if (!url) { showError('Please paste an Instagram link first.'); return; }
        if (!url.includes('instagram.com')) {
            showError('Please enter a valid Instagram URL');
            return;
        }

        startLoading();
        hideError();
        hideResult();

        try {
            const res  = await fetch(`/info?url=${encodeURIComponent(url)}`);
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Failed to fetch video info.');

            // Store Data
            currentCaption = data.caption || "";
            currentTitle   = data.title || "";

            // 1. Thumbnail
            if (resultThumb) {
                resultThumb.src = data.thumbnail || '/img/thumb-placeholder.png';
                resultThumb.onerror = () => { resultThumb.src = '/img/thumb-placeholder.png'; };
            }

            // Direct Download Links for Thumbnails (proxied)
            const thumbUrl = data.rawThumb || data.thumbnail;
            if (thumbUrl) {
                const downloadThumbUrl = `/download-thumb?url=${encodeURIComponent(thumbUrl)}`;
                thumbDlLinks.forEach(link => {
                    link.href = downloadThumbUrl;
                    link.removeAttribute('target'); // Download directly
                });
            }

            // 2. Text Content
            if (authorHandle) authorHandle.textContent = data.author || '@instagram';
            if (resultTitle)  resultTitle.textContent  = data.title || 'Instagram Video';
            if (resultCaptText) resultCaptText.textContent = data.caption || 'No caption found.';

            // 3. Download Button (main page only)
            if (dlMp4Btn && data.videoUrl) {
                const dlUrl = `/download?url=${encodeURIComponent(data.videoUrl)}&title=${encodeURIComponent(data.title)}`;
                dlMp4Btn.href = dlUrl;
                dlMp4Btn.removeAttribute('target');
            }

            showResult();

        } catch (err) {
            showError(err.message || 'Something went wrong. Please try again.');
        } finally {
            stopLoading();
        }
    });
}

// ── Toolkit & Clip ───────────────────────────────────────────
function toggleToolkit() {
    if (!toolkitBox) return;
    const isHidden = toolkitBox.style.display === 'none';
    toolkitBox.style.display = isHidden ? 'block' : 'none';
    if (isHidden) toolkitBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Global scope tracker for clip buttons
const clipCallbacks = new Map();

async function copyToClipboard(type, btnElement) {
    const text = type === 'title' ? currentTitle : currentCaption;
    if (!text) return;

    // Use event target if btnElement not provided
    const btn = btnElement || event.currentTarget;

    try {
        await navigator.clipboard.writeText(text);
        
        // Visual Feedback (instead of alert)
        const originalHTML = btn.getAttribute('data-oring') || btn.innerHTML;
        if (!btn.getAttribute('data-oring')) btn.setAttribute('data-oring', originalHTML);
        
        btn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
        btn.style.color = "#16a34a"; // Green
        
        // Reset after 3 seconds
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.color = "";
        }, 3000);

    } catch (err) {
        console.error('Copy failed', err);
    }
}

// ── UI Helpers ────────────────────────────────────────────────
function startLoading() {
    if (!loader) return;
    loader.style.display    = 'flex';
    submitBtn.disabled      = true;
    submitBtn.style.opacity = '0.7';
    const originalText = submitBtn.getAttribute('data-original') || submitBtn.innerHTML;
    if (!submitBtn.getAttribute('data-original')) submitBtn.setAttribute('data-original', originalText);
    submitBtn.innerHTML     = '<i class="fas fa-spinner fa-spin"></i> Processing...';
}

function stopLoading() {
    if (!loader) return;
    loader.style.display    = 'none';
    submitBtn.disabled      = false;
    submitBtn.style.opacity = '1';
    submitBtn.innerHTML     = submitBtn.getAttribute('data-original');
}

function showError(msg) {
    if (!errorMsg) return;
    errorMsg.textContent   = `⚠ ${msg}`;
    errorMsg.style.display = 'block';
}

function hideError() {
    if (errorMsg) errorMsg.style.display = 'none';
}

function showResult() {
    if (!resultOuter) return;
    resultOuter.style.display = 'flex';
    setTimeout(() => resultOuter.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
}

function hideResult() {
    if (resultOuter) resultOuter.style.display = 'none';
    if (toolkitBox) toolkitBox.style.display = 'none';
}

function resetForm() {
    if (form) form.reset();
    hideResult();
    hideError();
    if (dlMp4Btn) {
        dlMp4Btn.classList.remove('loading');
        dlMp4Btn.innerHTML = '<i class="fa-solid fa-film"></i> Download Video (MP4)';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Download Button Feedback ──────────────────────────
if (dlMp4Btn) {
    dlMp4Btn.addEventListener('click', function() {
        if (this.classList.contains('loading')) return;
        const originalHTML = this.innerHTML;
        this.classList.add('loading');
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting Download...';
        setTimeout(() => {
            this.classList.remove('loading');
            this.innerHTML = originalHTML;
        }, 6000);
    });
}

// ── Global UI (Scroll & Mobile Menu) ──────────────────────
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const navRight      = document.getElementById('navRight');

if (mobileMenuBtn && navRight) {
    mobileMenuBtn.addEventListener('click', () => {
        mobileMenuBtn.classList.toggle('active');
        navRight.classList.toggle('active');
    });
}

if (scrollTopBtn) {
    window.addEventListener('scroll', () => {
        scrollTopBtn.classList.toggle('show', window.scrollY > 300);
    });
    scrollTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}
