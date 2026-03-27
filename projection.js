// ============================================================
// PROJECTION.JS - Leo & Cynthia Wedding Projection Window
// Supabase project: oobjykyxsxhuvspnngbu
// ============================================================

const SUPABASE_URL = 'https://oobjykyxsxhuvspnngbu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vYmp5a3l4c3hodXZzcG5uZ2J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyOTAxMjgsImV4cCI6MjA4NTg2NjEyOH0.g2EYSamn6_dBCifFXfNjojvL9oYVj_uu5v2xhNzuEIo';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const projChannel = new BroadcastChannel('terracotta_proj');

// Helper: Build public URL safely using Supabase SDK
function storageUrl(bucket, filename) {
    const { data } = db.storage.from(bucket).getPublicUrl(filename);
    return data.publicUrl;
}

// ============================================================
// 1. BROADCAST CHANNEL — listens from console.js
// ============================================================
projChannel.onmessage = (event) => {
    const data = event.data;
    if (data.action === 'set_mode') {
        const memoryLane = document.getElementById('memory-lane');
        const wheelView = document.getElementById('wheel-view');
        memoryLane.style.opacity = data.mode === 'memory' ? '1' : '0';
        memoryLane.style.pointerEvents = data.mode === 'memory' ? 'auto' : 'none';
        wheelView.style.opacity = data.mode === 'wheel' ? '1' : '0';
        wheelView.style.pointerEvents = data.mode === 'wheel' ? 'auto' : 'none';
        document.getElementById('winner-modal').style.display = 'none';
    } else if (data.action === 'spin_wheel') {
        executeSpin(data.slots, data.winnerIndex, data.winnerName, data.winnerColor, data.membersText);
    }
};

function executeSpin(slots, winnerIndex, winnerName, winnerColor, membersText) {
    const wheel = document.getElementById('wheel');
    const total = slots.length;
    if (!wheel || total === 0) return;

    // Build conic gradient
    const anglePerSlot = 360 / total;
    const gradientStops = slots.map((slot, i) => {
        let color = slot.squad_colour || '#888888';
        if (!color.startsWith('#')) color = '#' + color;
        const start = i * anglePerSlot;
        const end = (i + 1) * anglePerSlot;
        return `${color} ${start}deg ${end}deg`;
    });

    // Apply gradient FIRST before any transition
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    wheel.style.background = `conic-gradient(${gradientStops.join(', ')})`;

    // Force browser repaint, then spin
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const slotMid = (winnerIndex * anglePerSlot) + (anglePerSlot / 2);
            const finalRotation = (360 * 8) + (360 - slotMid);
            wheel.style.transition = 'transform 6s cubic-bezier(0.23, 1, 0.32, 1)';
            wheel.style.transform = `rotate(${finalRotation}deg)`;

            setTimeout(() => {
                let bg = winnerColor || '#B32A19';
                if (!bg.startsWith('#')) bg = '#' + bg;
                document.getElementById('winner-box').style.backgroundColor = bg;
                document.getElementById('winner-squad-name').innerText = winnerName;
                document.getElementById('winner-members').innerText = membersText;
                document.getElementById('winner-modal').style.display = 'flex';
            }, 6500);
        });
    });
}


// ============================================================
// 2. WHEEL OF FORTUNE
// ============================================================


// ============================================================
// 3. MEMORY LANE — image streaming engine
// ============================================================

/*
 TIMING MATRIX (each state = 3 seconds, full cycle = 15 seconds)
 State index:  0=fade-in  1=static  2=static  3=fade-out  4=pause
 
 Loop | Offset (ticks)
 A    | 0   → state = tick % 5
 B    | +2  → state = (tick+2) % 5
 C    | +1  → state = (tick+1) % 5
 D    | +3  → state = (tick+3) % 5  (special source logic)

 D source: 50% blessing | 25% cover | 25% skip
 Decided at fade-in (state=0) only, then locked per cycle.
*/

let blessingPool = [];   // Array of public URLs
let coverPool = [];
let activeImageUrls = new Set();  // Track what's currently visible (incl. pause)

// Per-loop state: what image URL is assigned this cycle
const loopState = {
    A: { url: null, sourceDecided: false, dSource: null },
    B: { url: null, sourceDecided: false, dSource: null },
    C: { url: null, sourceDecided: false, dSource: null },
    D: { url: null, sourceDecided: false, dSource: null }
};

async function initMemoryLane() {
    console.log('[MemoryLane] Fetching image pools...');

    // Fetch blessing bucket file list
    const { data: bFiles, error: bErr } = await db.storage.from('Bless').list('', { limit: 500 });
    if (bErr) console.error('[MemoryLane] Error fetching blessing:', bErr.message);
    else {
        blessingPool = (bFiles || [])
            .filter(f => f.name && !f.name.startsWith('.') && f.name.includes('.'))
            .map(f => storageUrl('Bless', f.name));
        console.log(`[MemoryLane] Blessing pool: ${blessingPool.length} images`);
    }

    // Fetch cover bucket file list
    const { data: cFiles, error: cErr } = await db.storage.from('cover').list('', { limit: 500 });
    if (cErr) console.error('[MemoryLane] Error fetching cover:', cErr.message);
    else {
        coverPool = (cFiles || [])
            .filter(f => f.name && !f.name.startsWith('.') && f.name.includes('.'))
            .map(f => storageUrl('cover', f.name));
        console.log(`[MemoryLane] Cover pool: ${coverPool.length} images`);
    }

    if (blessingPool.length === 0 && coverPool.length === 0) {
        console.warn('[MemoryLane] No images found in any bucket. Check bucket names and RLS.');
        return;
    }

    startMemoryLaneTick();
}

function pickRandomFrom(pool) {
    // Prefer images not currently active
    const available = pool.filter(url => !activeImageUrls.has(url));
    const source = available.length > 0 ? available : pool; // fallback to full pool
    return source[Math.floor(Math.random() * source.length)] || null;
}

function getScreenQuadrant(loopId) {
    const buffer = 8; // 8% buffer from edges
    return {
        'A': { xMin: buffer, xMax: 50-buffer, yMin: buffer, yMax: 50-buffer }, // Top-left
        'B': { xMin: 50+buffer, xMax: 100-buffer, yMin: buffer, yMax: 50-buffer }, // Top-right
        'C': { xMin: buffer, xMax: 50-buffer, yMin: 50+buffer, yMax: 100-buffer }, // Bottom-left
        'D': { xMin: 50+buffer, xMax: 100-buffer, yMin: 50+buffer, yMax: 100-buffer } // Bottom-right
    }[loopId];
}

function handleImageLoop(loopId, state) {
    const el = document.getElementById(`ml-${loopId}`);
    if (!el) return;

    if (state === 0) {
        // FADE-IN: Decide image for this cycle

        // For D: decide source once per cycle
        if (loopId === 'D') {
            if (!loopState.D.sourceDecided) {
                const r = Math.random();
                if (r < 0.25)      loopState.D.dSource = 'skip';
                else if (r < 0.50) loopState.D.dSource = 'cover';
                else               loopState.D.dSource = 'Bless';
                loopState.D.sourceDecided = true;
            }
            if (loopState.D.dSource === 'skip') {
                el.style.opacity = '0';
                return;
            }
        }

        // Pick pool for this loop
        const pool = (loopId === 'D' && loopState.D.dSource === 'cover')
            ? coverPool
            : blessingPool;

        if (pool.length === 0) { el.style.opacity = '0'; return; }

        const selected = pickRandomFrom(pool);
        const isCover = (loopId === 'D' && loopState.D.dSource === 'cover') || selected.includes('cover');
        const baseSize = 16.6 + Math.random() * 8.4;
        const sizeVw = isCover ? baseSize * 1.5 : baseSize; // Cover images 50% larger

        if (!selected) { el.style.opacity = '0'; return; }

        // Release old URL from active set before assigning new one
        if (el.dataset.url) activeImageUrls.delete(el.dataset.url);

        el.dataset.url = selected;
        activeImageUrls.add(selected);
        loopState[loopId].url = selected;

        // Random size: 1/6 to 1/4 of screen (16.6vw to 25vw)
        const q = getScreenQuadrant(loopId);
        const xRange = q.xMax - q.xMin - sizeVw;
        const yRange = q.yMax - q.yMin - sizeVw;
        const xPos = q.xMin + Math.max(0, Math.random() * xRange);
        const yPos = q.yMin + Math.max(0, Math.random() * yRange);

        el.style.width = `${sizeVw}vw`;
        el.style.height = `${sizeVw}vw`;
        el.style.left = `${xPos}vw`;
        el.style.top = `${yPos}vh`;
        el.style.backgroundImage = `url('${selected}')`;
        el.style.opacity = '1'; // CSS transition handles 3s fade

    } else if (state === 3) {
        // FADE-OUT: CSS transition fades over 3s
        el.style.opacity = '0';

    } else if (state === 4) {
        // PAUSE: Cleanup, release URL, reset source decision for next cycle
        if (el.dataset.url) {
            activeImageUrls.delete(el.dataset.url);
            el.dataset.url = '';
        }
        el.style.backgroundImage = 'none';
        if (loopId === 'D') loopState.D.sourceDecided = false;
    }
    // states 1 & 2 (STATIC): do nothing, image stays visible
}

function startMemoryLaneTick() {
    let tick = 0;
    console.log('[MemoryLane] Tick engine started.');

    // Run immediately at t=0, then every 3 seconds
    function tick3() {
        // A: offset 0 → tick % 5
        handleImageLoop('A', tick % 5);
        // B: offset +2 → so at tick=0 B is at state 2 (mid-static). (tick+2) % 5
        handleImageLoop('B', (tick + 2) % 5);
        // C: offset +1 → (tick+1) % 5
        handleImageLoop('C', (tick + 1) % 5);
        // D: offset +3 → (tick+3) % 5
        handleImageLoop('D', (tick + 3) % 5);
        tick++;
    }

    tick3(); // fire immediately
    setInterval(tick3, 3000);
}

// Double-click anywhere to toggle fullscreen
document.addEventListener('dblclick', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => console.warn(err));
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
});

// Boot memory lane on load
initMemoryLane();