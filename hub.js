/**
 * Main Hub, Authentication, and UI Navigation Logic
 */

function handleSignIn() {
    const input = document.getElementById('username-input');
    const name = input.value.trim();
    if (!name) return;

    currentUser = name;
    // Save session for persistent login across refreshes
    localStorage.setItem('ultimate_energy_current_session', currentUser);

    const savedData = localStorage.getItem(`ultimate_energy_score_${currentUser}`);
    p1Score = savedData ? parseInt(savedData) : 0;

    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('main-menu-screen').classList.remove('hidden');
    document.getElementById('p1-display-name').innerText = currentUser;
    updateScoreboard();
    updateUI();
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
    document.getElementById('main-menu-screen').classList.remove('hidden');
    updateScoreboard();
}

/**
 * Scans localStorage for saved scores and renders the Leaderboard.
 */
function updateScoreboard() {
    const list = document.getElementById('scoreboard-list');
    if (!list) return;
    list.innerHTML = "";

    const scores = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('ultimate_energy_score_')) {
            const username = key.replace('ultimate_energy_score_', '');
            const score = parseInt(localStorage.getItem(key)) || 0;
            scores.push({ username, score });
        }
    }

    scores.sort((a, b) => b.score - a.score);

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
function handleSignOut() {
    if (!confirm("Are you sure? This will sign you out and DELETE your saved score progress.")) return;

    if (currentUser) {
        localStorage.removeItem(`ultimate_energy_score_${currentUser}`);
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
    if (socket) socket.disconnect();
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