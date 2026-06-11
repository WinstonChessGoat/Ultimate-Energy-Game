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

async function handleSignIn(isAuto = false) {
    const emailInput = document.getElementById('email-input');
    const usernameInput = document.getElementById('username-input');
    const passwordInput = document.getElementById('password-input');
    const errorEl = document.getElementById('auth-error');
    const btn = document.getElementById('signin-btn');
    const btnText = document.getElementById('signin-btn-text');
    const spinner = document.getElementById('signin-spinner');
    
    if (errorEl) errorEl.innerText = ""; // Clear any previous error messages

    const email = emailInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!isAuto) {
        if (!email || !password) {
            alert("Email and Password are required.");
            return;
        }
        // Show loading state on button for manual login
        if (btn) btn.disabled = true;
        if (btnText) btnText.innerText = "Signing In...";
        if (spinner) spinner.classList.remove('hidden');
    }

    // Store email as our primary key for the session
    currentUser = email; 
    localStorage.setItem('ultimate_energy_email', email);
    localStorage.setItem('ultimate_energy_password', password);
    localStorage.setItem('ultimate_energy_username', username);

    try {
        const response = await fetch(`${IS_PROD ? RENDER_URL : ''}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, username: username || email.split('@')[0] })
        });
        const result = await response.json();

        if (response.ok) {
            p1Score = result.score;
            document.getElementById('p1-display-name').innerText = result.username;
            // In case of background sync, update the stored username
            localStorage.setItem('ultimate_energy_username', result.username);
            
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('main-menu-screen').classList.remove('hidden');
            showLoading(false); // Hide the overlay spinner if it was shown
        } else {
            // If auto-login fails (e.g., password changed), bring them back to sign-in
            if (isAuto) {
                handleSignOut(false); // Silent sign out
                showLoading(false);
            } else if (errorEl) {
                errorEl.innerText = result.error || "Login failed";
            } else {
                alert(result.error || "Login failed");
            }
        }
    } catch (err) {
        console.error("Login request failed:", err);
    } finally {
        // Reset loading state
        if (btn) btn.disabled = false;
        if (btnText) btnText.innerText = "Sign In";
        if (spinner) spinner.classList.add('hidden');
    }
    updateScoreboard();
    updateUI();
}

async function saveScoreToServer(username, score) {
    await saveLocalScore(username, score); // Always save to IndexedDB first
    fetch(`${IS_PROD ? RENDER_URL : ''}/api/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser, score })
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
async function handleSignOut(confirmOut = true) {
    if (confirmOut && !confirm("Are you sure? This will sign you out and DELETE your saved score progress.")) return;

    if (currentUser) {
        await deleteLocalScore(currentUser);
        localStorage.removeItem('ultimate_energy_email');
        localStorage.removeItem('ultimate_energy_password');
        localStorage.removeItem('ultimate_energy_username');
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
    const savedEmail = localStorage.getItem('ultimate_energy_email');
    const savedPassword = localStorage.getItem('ultimate_energy_password');
    const savedUsername = localStorage.getItem('ultimate_energy_username');
    
    if (savedEmail && savedPassword) {
        // SHORTER TIME TO POP UP: Immediately hide the login screen
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('main-menu-screen').classList.remove('hidden');
        
        // Show the loading overlay so the user knows a background sync is happening
        showLoading(true, "Syncing profile...");

        // Populate UI with cached info so it doesn't look empty while we wait for the server
        if (savedUsername) document.getElementById('p1-display-name').innerText = savedUsername;
        
        // Execute background login
        handleSignIn(true);
    }
});