// Initialization
const supabaseUrl = 'https://oobjykyxsxhuvspnngbu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vYmp5a3l4c3hodXZzcG5uZ2J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyOTAxMjgsImV4cCI6MjA4NTg2NjEyOH0.g2EYSamn6_dBCifFXfNjojvL9oYVj_uu5v2xhNzuEIo';
const db = window.supabase.createClient(supabaseUrl, supabaseKey);
const projChannel = new BroadcastChannel('terracotta_proj');

// TAB SWITCHING
function switchTab(tabId) {
    document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    document.querySelectorAll('.content-tab').forEach(content => content.classList.add('hidden'));
    document.getElementById('content-' + tabId).classList.remove('hidden');
    if (tabId === 'database') loadTableData();
}

// MASTER DASHBOARD
async function loadMasterDashboard() {
    // Arrival Status
    const { data: status } = await db.from('status').select('*');
    const arrived = status.filter(s => s.checkintime).length;
    const onway = status.filter(s => !s.checkintime && s.etahours).length;
    const pending = status.length - arrived - onway;
    
    document.getElementById('arrived-count').textContent = arrived;
    document.getElementById('onway-count').textContent = onway;
    document.getElementById('pending-count').textContent = pending;

    // Squad breakdown + scores (from game table)
    const { data: games } = await db.from('game').select('squadname, drinkslot');
    document.getElementById('squad-breakdown').innerHTML = 
        games.map(g => `<div class="flex justify-between"><span>${g.squadname}</span><span class="font-bold">${g.drinkslot}</span></div>`).join('');

    document.getElementById('squad-scores').innerHTML = 
        games.map(g => `<div class="flex justify-between"><span>${g.squadname}</span><span class="text-green-400 font-bold">${g.drinkslot}</span></div>`).join('');

    // ETA timeline (simplified)
    for (let i = 0; i <= 3; i++) {
        const count = status.filter(s => s.etahours === i).length;
        document.getElementById(`eta-t${i}`).textContent = count;
    }

    // Event rundown (static for now)
    document.getElementById('event-rundown').innerHTML = `
        <div>20:00 - Welcome Drinks</div>
        <div>20:30 - Raise Glasses</div>
        <div>21:00 - Wheel of Fortune</div>
        <div>21:30 - Memory Lane</div>
    `;
}

// Call on boot
loadMasterDashboard();

async function loadDashboard() {
    const { count: checkins } = await db.from('status').select('*', { count: 'exact', head: true }).not('checkin_time', 'is', null);
    const { count: ubers } = await db.from('status').select('*', { count: 'exact', head: true }).eq('uber_match', 'TRUE');
    
    document.getElementById('dashboard-stats').innerHTML = `
        <div class="bg-[#1a1a1a] border border-[#333] p-4">
            <p class="text-[10px] uppercase text-gray-500 mb-2">Total Check-ins</p>
            <p class="text-3xl font-bold">${checkins || 0}</p>
        </div>
        <div class="bg-[#1a1a1a] border border-[#333] p-4">
            <p class="text-[10px] uppercase text-gray-500 mb-2">Uber Matches</p>
            <p class="text-3xl font-bold text-blue-500">${ubers || 0}</p>
        </div>
    `;
}

// DATABASE EDITOR LOGIC
let currentTable = 'profile';
let dbSubscription = null;

const primaryKeys = {
    'profile': 'uid', 'status': 'uid', 'survey': 'uid', 'reception': 'uid', 'push_subscriptions': 'uid',
    'game': 'squad_name', 'blessing': 'id'
};

document.getElementById('db-table-select').addEventListener('change', (e) => {
    currentTable = e.target.value;
    loadTableData();
});

async function loadTableData() {
    const { data, error } = await db.from(currentTable).select('*').order(primaryKeys[currentTable], { ascending: true });
    if (error) return console.error(error);
    renderGrid(data);
    setupRealtime();
}

function renderGrid(data) {
    const thead = document.getElementById('db-head');
    const tbody = document.getElementById('db-body');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td class="text-center p-4">No data found.</td></tr>';
        return;
    }

    const cols = Object.keys(data[0]);
    thead.innerHTML = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
    
    tbody.innerHTML = data.map(row => {
        const pk = row[primaryKeys[currentTable]];
        return `<tr>${cols.map(c => 
            `<td contenteditable="true" data-pk="${pk}" data-col="${c}" onblur="saveCell(this, '${row[c]}')">${row[c] !== null ? row[c] : ''}</td>`
        ).join('')}</tr>`;
    }).join('');
}

async function saveCell(cell, oldVal) {
    const newVal = cell.innerText.trim();
    if (newVal === oldVal) return; // No change
    
    const pk = cell.getAttribute('data-pk');
    const col = cell.getAttribute('data-col');
    
    // Update DB
    cell.style.backgroundColor = '#444'; // Loading state
    const { error } = await db.from(currentTable).update({ [col]: newVal === '' ? null : newVal }).eq(primaryKeys[currentTable], pk);
    cell.style.backgroundColor = error ? '#B32A19' : 'transparent';
}

function setupRealtime() {
    if (dbSubscription) dbSubscription.unsubscribe();
    dbSubscription = db.channel('db-editor')
        .on('postgres_changes', { event: '*', schema: 'public', table: currentTable }, () => loadTableData())
        .subscribe();
}

// PROJECTION CONTROLS
function setProjectionMode(mode) {
    document.getElementById('toggle-memory-btn').classList.toggle('active-projection-btn', mode === 'memory');
    document.getElementById('toggle-wheel-btn').classList.toggle('active-projection-btn', mode === 'wheel');
    projChannel.postMessage({ action: 'set_mode', mode: mode });
}

async function triggerWheelSpin() {
    // Live fetch from game table
    const { data: games } = await db
        .from('game')
        .select('squad_name, drink_slot, squad_colour')
        .gt('drink_slot', 0);
    
    if (!games || games.length === 0) {
        alert('No valid drink slots found in game table.');
        return;
    }

    // Build slots array from drink_slot values
    let slots = [];
    games.forEach(g => {
        for (let i = 0; i < g.drink_slot; i++) {
            slots.push(g);
        }
    });

    const winnerIndex = Math.floor(Math.random() * slots.length);
    const winner = slots[winnerIndex];

    // Get squad members
    const { data: members } = await db
        .from('profile')
        .select('givenname')
        .eq('squad_name', winner.squad_name);

    const memberNames = members?.map(m => m.givenname).join(', ') || '';

    // Broadcast to projection window
    projChannel.postMessage({
        action: 'spin_wheel',
        slots,
        winnerIndex,
        winnerName: winner.squad_name,
        winnerColor: winner.squad_colour,
        membersText: memberNames
    });

    document.getElementById('latest-spin-result').innerText = 
        `Spinning... Expected: ${winner.squad_name}`;
}

// Boot
loadDashboard();
loadTableData();