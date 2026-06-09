/**
 * Main Hub, Authentication, and UI Navigation Logic
 */

// IndexedDB Setup for local persistence
const DB_NAME = 'UltimateEnergyDB';
const DB_STORE = 'playerScores';

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(DB_STORE)) {
                db.createObjectStore(DB_STORE, { keyPath: 'username' });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getLocalScore(username) {
    const db = await initDB();
    return new Promise((resolve) => {
        const transaction = db.transaction([DB_STORE], 'readonly');
        const request = transaction.objectStore(DB_STORE).get(username);
        request.onsuccess = () => resolve(request.result ? request.result.score : 0);
        request.onerror = () => resolve(0);
    });
}

async function saveLocalScore(username, score) {
    const db = await initDB();
    const transaction = db.transaction([DB_STORE], 'readwrite');
    transaction.objectStore(DB_STORE).put({ username, score });
}

async function deleteLocalScore(username) {
    const db = await initDB();
    const transaction = db.transaction([DB_STORE], 'readwrite');
    transaction.objectStore(DB_STORE).delete(username);
}

async function handleSignIn() {
    const input = document.getElementById('username-input');
    const name = input.value.trim();
    if (!name) return;

    currentUser = name;
    localStorage.setItem('ultimate_energy_current_session', currentUser);

    try {
        const response = await fetch(`${IS_PROD ? RENDER_URL : ''}/api/score/${currentUser}`);
        const data = await response.json();
        
        // If server has the score, use it. Otherwise, check local IndexedDB.
        if (data.score && data.score > 0) {
            p1Score = data.score;
        } else {
            p1Score = await getLocalScore(currentUser);
        }
    } catch (err) {
        console.warn("Server score fetch failed, falling back to IndexedDB:", err);
        p1Score = await getLocalScore(currentUser);
    }

    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('main-menu-screen').classList.remove('hidden');
    document.getElementById('p1-display-name').innerText = currentUser;
    updateScoreboard();
    updateUI();
}

async function saveScoreToServer(username, score) {
    await saveLocalScore(username, score); // Always save to IndexedDB first
    fetch(`${IS_PROD ? RENDER_URL : ''}/api/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, score })
    }).catch(err => console.error("Database save failed:", err));
}

/**
 * Navigates to the Battle selection screen.
 */
function goToBattleMenu() {
    document.getElementById('main-menu-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
}

/**
 * Navigates to the World exploration screen.
 */
function goToWorld() {
    isInWorld = true;
    document.getElementById('main-menu-screen').classList.add('hidden');
    document.getElementById('world-screen').classList.remove('hidden');
    document.getElementById('jump-btn').classList.remove('hidden');
}

/**
 * Returns to the main hub from any other screen.
 */
function goToMainMenu() {
    isInWorld = false;
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('world-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('p1-unit-guide').classList.add('hidden');
    document.getElementById('p2-unit-guide').classList.add('hidden'); 
    document.getElementById('jump-btn').classList.add('hidden');
    document.getElementById('main-menu-screen').classList.remove('hidden');
    updateScoreboard();
}

/**
 * Scans localStorage for saved scores and renders the Leaderboard.
 */
async function updateScoreboard() {
    const list = document.getElementById('scoreboard-list');
    if (!list) return;
    list.innerHTML = "";

    let scores = [];
    try {
        const response = await fetch(`${IS_PROD ? RENDER_URL : ''}/api/leaderboard`);
        if (response.ok) scores = await response.json();
        else throw new Error("API Offline");
    } catch (err) {
        console.warn("Leaderboard API failed, using local data:", err);
        const db = await initDB();
        scores = await new Promise((resolve) => {
            const req = db.transaction([DB_STORE], 'readonly').objectStore(DB_STORE).getAll();
            req.onsuccess = () => resolve(req.result);
        });
        scores.sort((a, b) => b.score - a.score);
    }

    scores.slice(0, 5).forEach((entry, index) => {
        const div = document.createElement('div');
        div.className = 'score-item';
        if (entry.username === currentUser) div.style.backgroundColor = "rgba(0, 255, 204, 0.1)";
        div.innerHTML = `
            <span class="rank">#${index + 1}</span>
            <span class="name">${entry.username}</span>
            <span class="val">${entry.score} pts</span>
        `;
        list.appendChild(div);
    });

    if (scores.length === 0) {
        list.innerHTML = "<div style='color:#666; font-size:0.8em; padding:10px;'>No scores recorded yet.</div>";
    }
}

/**
 * Handles signing out the user and wiping their saved progress from storage.
 */
async function handleSignOut() {
    if (!confirm("Are you sure? This will sign you out and DELETE your saved score progress.")) return;

    if (currentUser) {
        await deleteLocalScore(currentUser);
        localStorage.removeItem('ultimate_energy_current_session');
    }
    
    currentUser = null;
    p1Score = 0;
    
    document.getElementById('username-input').value = "";
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('main-menu-screen').classList.add('hidden');
    document.getElementById('world-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('p1-unit-guide').classList.add('hidden');
    document.getElementById('p2-unit-guide').classList.add('hidden');
    
    updateUI();
    log("System: Progress reset and signed out.");
}

function showLoading(show, text = "Searching for player...") {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    if (textEl) textEl.innerText = text;
    if (overlay) {
        if (show) overlay.classList.remove('hidden');
        else overlay.classList.add('hidden');
    }
}

function cancelMatchmaking() {
    if (socket) socket.close();
    showLoading(false);
}

function announce(text) {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.pitch = 1.2;
        utterance.rate = 1.1;
        window.speechSynthesis.speak(utterance);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('ultimate_energy_current_session');
    if (savedUser) {
        document.getElementById('username-input').value = savedUser;
        handleSignIn();
    }
});