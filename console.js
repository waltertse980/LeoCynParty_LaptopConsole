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

// DASHBOARD LOGIC
async function loadDashboard() {
    const { count: checkins } = await db.from('status').select('*', { count: 'exact', head: true }).not('checkintime', 'is', null);
    const { count: ubers } = await db.from('status').select('*', { count: 'exact', head: true }).eq('ubermatch', 'TRUE');
    
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
    'game': 'squadname', 'blessing': 'id'
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
    // 1. Fetch game table to resolve slots
    const { data: games } = await db.from('game').select('squadname, drink_slot, squadcolour').gt('drink_slot', 0);
    if (!games || games.length === 0) return alert("No valid drink slots found in game table.");

    // 2. Build flattened array of slots based on drink_slot value
    let slots = [];
    games.forEach(g => {
        for(let i=0; i < g.drink_slot; i++) slots.push(g);
    });

    // 3. Pick random winner index
    const winnerIndex = Math.floor(Math.random() * slots.length);
    const winner = slots[winnerIndex];

    // 4. Fetch team members to show in modal
    const { data: members } = await db.from('profile').select('givenname').eq('squadname', winner.squadname);
    const memberNames = members ? members.map(m => m.givenname).join(', ') : '';

    // 5. Send data to Projection Window to trigger animation
    projChannel.postMessage({
        action: 'spin_wheel',
        slots: slots,
        winnerIndex: winnerIndex,
        winnerName: winner.squadname,
        winnerColor: winner.squadcolour,
        membersText: memberNames
    });

    document.getElementById('latest-spin-result').innerText = `Spinning... Expected Winner: ${winner.squadname}`;
}

// Boot
loadDashboard();
loadTableData();