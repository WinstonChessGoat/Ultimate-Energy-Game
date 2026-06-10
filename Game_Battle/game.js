/**
 * The Ultimate Energy Game - Core Logic
 */

const PANIC_TIME_LIMIT = 1;

// Environment detection for the client
// Define your Render URL here
const RENDER_URL = 'https://ultimate-energy-game.onrender.com';

// Detect if we are on a live host (Render or GitHub Pages)
const IS_PROD = window.location.hostname.includes('onrender.com') || window.location.hostname.includes('github.io');
const ENV_NAME = IS_PROD ? 'PRODUCTION' : 'LOCAL';

// You can use this for conditional logging or different API URLs
console.log(`[Game] Current Environment: ${ENV_NAME}`);

const UNITS = {
    1: { name: "Charge", cost: 0 },
    2: { name: "Fireball", cost: 1 },
    3: { name: "Tornado", cost: 2 },
    4: { name: "Earthquake", cost: 3 },
    5: { name: "Tsunami", cost: 4 },
    6: { name: "Blackhole", cost: 5 },
    7: { name: "Megashield", cost: 10 },
    8: { name: "Ultimate Attack", cost: 12 },
    9: { name: "Shield/Guard", cost: 0 } // Cost 0 as it's purely defensive
};

// Mapping keys to unit IDs
const P2_KEYS = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9 };
const P1_KEYS = { 'q': 1, 'w': 2, 'e': 3, 'r': 4, 't': 5, 'y': 6, 'u': 7, 'i': 8, 'o': 9 };

let p1 = { x: 0, y: 0, energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0, inventory: { wood: 0, axe: 0 }, axeUsesLeft: 0 };
let p2 = { x: 0, y: 0, energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0, inventory: { wood: 0, axe: 0 }, axeUsesLeft: 0 };
let p1Score = 0;
let roundCount = 1;
let currentUser = null;
let turnTimer = null;
let timeLeft = PANIC_TIME_LIMIT;
let aiThinkingTimeout = null;
let isAIMode = true;
let isOnlineMode = false;
let isInWorld = false;
let myRole = null; // 'p1' or 'p2'
let socket = null;
let currentRoomId = null;

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (isInWorld) return; // World handles its own keydowns for movement and cutting

    // If mobile PvP, keyboard input for unit selection is not expected
    if (isMobile() && !isAIMode && !isOnlineMode) {
        return;
    }

    if (!p1.alive || !p2.alive) {
        if (key === 'enter') {
            requestRestart();
        }
        return;
    }
    // Existing combat unit selection logic
    handleCombatKeys(key);
});

function hostOnlineGame() {
    isOnlineMode = true;
    isAIMode = false;
    myRole = 'p1';
    currentRoomId = Math.random().toString(36).substr(2, 6); // Simple random ID
    
    showLoading(true, "Creating Lobby...");
    setupSocket(currentRoomId);
    
    showLoading(true, "Lobby Created! Waiting for opponent...\nID: " + currentRoomId);
    log(`System: Waiting for guest to join... ID: ${currentRoomId}`);
}

function joinOnlineGame() {
    const hostId = document.getElementById('join-id-input').value.trim();
    currentRoomId = hostId || 'public-lobby';
    
    isOnlineMode = true;
    isAIMode = false;
    myRole = 'p2';

    showLoading(true, "Connecting to Lobby...");
    setupSocket(currentRoomId);
}

function setupSocket(roomId) {
    if (socket) socket.close();

    // Connect to local server if developing, otherwise connect to Render
    const protocol = IS_PROD ? 'wss' : 'ws';
    // Fallback to localhost if hostname is empty (e.g., opened via file://)
    const currentHostname = window.location.hostname || 'localhost';
    const host = IS_PROD ? RENDER_URL.replace(/^https?:\/\//, '') : `${currentHostname}:9000`;
    const socketUrl = `${protocol}://${host}/${roomId}`;

    console.log(`[Socket] Connecting to: ${socketUrl}`);
    console.log(`[Client] Initializing a new WebSocket instance for this session.`);
    socket = new WebSocket(socketUrl);

    socket.onopen = () => {
        console.log(`[Socket] Connected to room: ${roomId}`);
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'assign-role') {
            myRole = data.role;
            console.log(`[Socket] Role assigned: ${myRole}`);
            return;
        }
        if (data.type === 'room-ready') {
            const loadingOverlay = document.getElementById('loading-overlay');
            if (loadingOverlay.classList.contains('hidden')) return;
            log("System: Connected to opponent!");
            showLoading(false);
            initGame(false);
            return;
        }
        if (data.type === 'opponent-disconnected') {
            log("System: Connection lost.");
            alert("Opponent disconnected.");
            goToMainMenu();
            return;
        }

        const opponentRole = myRole === 'p1' ? 'p2' : 'p1';
        const opp = opponentRole === 'p1' ? p1 : p2;

        if (data.type === 'ERROR') {
            alert(data.msg);
            showLoading(false);
            goToMenu();
        }
        else if (data.type === 'MOVE') selectMove(opponentRole, data.unitId, true);
        else if (data.type === 'RESTART') resetGame();
        else if (data.type === 'SYNC_TIMER') startPanicTimer(data.latePlayer, true);
        else if (data.type === 'POS') { opp.x = data.x; opp.y = data.y; }
        else if (data.type === 'ENERGY_UPDATE') { opp.energy = data.energy; opp.inventory.wood = data.inventoryWood; updateUI(); }
        else if (data.type === 'INVENTORY_UPDATE') { 
            opp.inventory.wood = data.inventoryWood; 
            if (data.inventoryAxe !== undefined) opp.inventory.axe = data.inventoryAxe;
            if (data.inventoryDefense !== undefined) opp.inventory.defenseItems = data.inventoryDefense;
            updateUI(); 
        }
    };

    socket.onerror = (err) => {
        console.error("[Socket] Error:", err);
    };

    socket.onclose = () => {
        console.log("[Socket] Connection closed.");
    };
}

function handleCombatKeys(key) {
    if (isOnlineMode) {
        // Respect role-based keys in online mode: P1 uses Q-O, P2 uses 1-9
        const myKeys = myRole === 'p1' ? P1_KEYS : P2_KEYS;
        const myChar = myRole === 'p1' ? p1 : p2;
        if (myKeys[key] && myChar.choice === null) {
            selectMove(myRole, myKeys[key]);
        }
        return;
    }

    // Local game mode (VS AI or VS Player 2)
    if (P1_KEYS[key] && p1.choice === null) {
        selectMove('p1', P1_KEYS[key]);
    } else if (!isAIMode && P2_KEYS[key] && p2.choice === null) {
        selectMove('p2', P2_KEYS[key]);
    }
}

/**
 * Handles unit selection via UI button clicks (Mobile Friendly)
 */
function handleUnitClick(playerStr, unitId) {
    if (isInWorld) return;
    if (!p1.alive || !p2.alive) return;

    if (isOnlineMode) {
        if ((myRole === 'p1' ? p1 : p2).choice === null) selectMove(myRole, unitId);
    } else { // Local game mode (VS AI or VS Player 2)
        if (playerStr === 'p1' && p1.choice === null) selectMove('p1', unitId);
        else if (playerStr === 'p2' && !isAIMode && p2.choice === null) selectMove('p2', unitId);
    }
}

/**
 * Synchronized restart for Multiplayer and Local
 */
function requestRestart() {
    if (!confirm('Restart Game?')) return;
    if (isOnlineMode && socket) {
        socket.send(JSON.stringify({ type: 'RESTART' }));
    }
    resetGame();
}

// Expose global functions for world.js to use
window.log = log;
window.updateUI = updateUI;

function initGame(vsAI) {
    isAIMode = vsAI;
    const gameScreen = document.getElementById('game-screen');
    const mobileContainer = document.getElementById('mobile-p2-ui-container');
    const mobileP1Container = document.getElementById('mobile-p1-ui-container');
    const p1UnitGuide = document.getElementById('p1-unit-guide');
    
    // Reset UI states
    gameScreen.classList.remove('mobile-pvp-layout');
    mobileContainer.classList.add('hidden');
    mobileP1Container.classList.add('hidden');
    mobileContainer.innerHTML = '';
    mobileP1Container.innerHTML = '';

    document.getElementById('menu-screen').classList.add('hidden');
    gameScreen.classList.remove('hidden');
    p1UnitGuide.classList.remove('hidden');
    
    const p1Name = document.getElementById('p1-display-name');
    const p2Name = document.getElementById('p2-display-name');
    const p2Guide = document.getElementById('p2-unit-guide');
    p2Guide.classList.add('hidden');

    // Mobile UI setup for all modes (VS AI, Local PvP, Online)
    if (isMobile()) {
        gameScreen.classList.add('mobile-pvp-layout');
        
        const localRole = isOnlineMode ? myRole : 'p1';
        const remoteRole = localRole === 'p1' ? 'p2' : 'p1';

        // Setup Local Player UI at the bottom
        mobileP1Container.classList.remove('hidden');
        setupMobilePlayerUI(mobileP1Container, localRole, true);
        
        // Setup Opponent UI at the top (Only show buttons for Local PvP)
        mobileContainer.classList.remove('hidden');
        const showOpponentButtons = (!vsAI && !isOnlineMode);
        setupMobilePlayerUI(mobileContainer, remoteRole, showOpponentButtons);

        p1UnitGuide.classList.add('hidden'); // Hide original keyboard-centric guide
    } else {
        if (!vsAI && !isOnlineMode) {
            // Desktop PvP: Hide the secondary unit guide
            p2Guide.classList.add('hidden');
        }
    }

    if (isOnlineMode) {
        if (myRole === 'p1') {
            p1Name.innerText = currentUser || "Player 1";
            p2Name.innerText = "Opponent";
        } else {
            p1Name.innerText = "Opponent";
            p2Name.innerText = currentUser || "Player 2";
        }
    } else {
        p1Name.innerText = currentUser || "Player 1";
        p2Name.innerText = isAIMode ? "AI Bot" : "Player 2";
    }
    
    const controls = document.getElementById('controls-text');
    if (isOnlineMode) {
        const keyHint = myRole === 'p1' ? "Q,W,E,R,T,Y,U,I,O" : "1,2,3,4,5,6,7,8,9";
        controls.innerText = `Online Mode | You are ${myRole.toUpperCase()} | Keys: ${keyHint}`;
    } else if (isAIMode) {
        controls.innerText = "Player 1 Keys: Q,W,E,R,T,Y,U,I,O | AI Mode | Press Enter to Restart";
    } else {
        controls.innerText = isMobile() ? "Touch buttons to play!" : "P1: Q,W,E,R,T,Y,U,I,O | P2: 1-9 | Press Enter to Restart";
    }
    
    resetGame();
}

function setupMobilePlayerUI(container, playerStr, showButtons = true) {
    container.innerHTML = '';

    // 1. Clone the player info box (Energy, Score, Status)
    const boxId = playerStr === 'p1' ? 'p1-box' : 'p2-box';
    const originalBox = document.getElementById(boxId);
    if (!originalBox) return;
    
    const boxClone = originalBox.cloneNode(true);
    // Suffix IDs inside the box for updateUI to find them (e.g., p1-energy-mobile)
    const suffixer = (el) => {
        if (el.id) el.id = el.id + '-mobile';
        Array.from(el.children).forEach(suffixer);
    };
    suffixer(boxClone);

    // 2. Clone the unit buttons
    let guideClone = null;
    if (showButtons) {
        const originalGuide = document.getElementById('p1-unit-guide');
        if (originalGuide) {
            guideClone = originalGuide.cloneNode(true);
            guideClone.id = `${playerStr}-unit-guide-mobile`;
            guideClone.classList.remove('hidden');
            guideClone.className = 'unit-guide-container';

            // Fix button IDs and click handlers for the specific player
            const cards = guideClone.querySelectorAll('.unit-card');
            cards.forEach((card, index) => {
                const unitId = index + 1;
                if (unitId <= 9) {
                    card.id = `${playerStr}-unit-btn-mobile-${unitId}`;
                    card.setAttribute('onclick', `handleUnitClick('${playerStr}', ${unitId})`);
                } else {
                    card.setAttribute('onclick', 'requestRestart()');
                }
            });
        }
    }

    // 3. Assemble: Mirror layout puts buttons closest to the player's thumbs at the screen edges
    if (playerStr === 'p2') {
        if (guideClone) container.appendChild(guideClone);
        container.appendChild(boxClone);
    } else {
        container.appendChild(boxClone);
        if (guideClone) container.appendChild(guideClone);
    }
}

function goToMenu() {
    clearTimeout(turnTimer);
    clearTimeout(aiThinkingTimeout);
    document.getElementById('menu-screen').classList.remove('hidden');
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('p1-unit-guide').classList.add('hidden');
    document.getElementById('p2-unit-guide').classList.add('hidden');
}

function resetGame() {
    p1 = { x: 100, y: 200, energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0, inventory: { wood: 0, axe: 0 }, axeUsesLeft: 0 };
    p2 = { x: 500, y: 200, energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0, inventory: { wood: 0, axe: 0 }, axeUsesLeft: 0 };
    roundCount = 1;
    clearTimeout(turnTimer);
    clearTimeout(aiThinkingTimeout);
    log("Welcome! Choose your units to begin.", true); // Use true to clear
    document.getElementById('timer-display').innerText = "";
    updateUI();
    startRound();
}

function startRound() {
    if (!p1.alive || !p2.alive) return;
    
    p1.choice = null;
    p2.choice = null;
    
    log(`System: Round ${roundCount} Started!`);

    updateStatuses("Waiting...", isAIMode ? "AI Thinking..." : "Waiting...", "#888");

    if (!isAIMode) return;

    // AI "thinks": 0.2 to 0.7 seconds (well within 1s panic limit)
    const aiThinkingTime = Math.random() * 500 + 200;
    aiThinkingTimeout = setTimeout(makeAIChoice, aiThinkingTime);
}

function makeAIChoice() {
    if (p2.choice !== null || !p2.alive) return;

    const p1E = p1.energy;
    const p2E = p2.energy;
    
    const movePool = [];

    // Evaluate moves based on current game state
    
    // Charge (1): Core move to gain energy
    let chargeWeight = 50;
    if (p1E === 0) chargeWeight += 30; // Safer to charge when opponent has no energy
    if (p2E < 10) chargeWeight += 20;  // High priority if we need energy for finishers
    movePool.push({ id: 1, weight: chargeWeight });

    // Guard (9): Counter for Fireball(2) and Tornado(3)
    let guardWeight = (p1E === 1 || p1E === 2) ? 65 : 5;
    if (p1E >= 3) guardWeight = 0; // Guard is useless against Earthquake+
    movePool.push({ id: 9, weight: guardWeight });

    // Offensive moves (2-6)
    for (let id = 2; id <= 6; id++) {
        const cost = UNITS[id].cost;
        if (p2E >= cost) {
            let weight = 20;
            if (id > p1E) weight += 40; // Likely to overpower player's current capacity
            if (p1E === 0 && id >= 4) weight += 100; // Guaranteed kill if player charges/guards
            if (p1E >= 10) weight += 150; // Desperation: must try to kill player before they use finishers
            movePool.push({ id, weight });
        }
    }

    // Finishers (7-8): Game enders
    if (p2E >= 12) movePool.push({ id: 8, weight: 1000 });
    else if (p2E >= 10) movePool.push({ id: 7, weight: 900 });

    // Select move using weighted random for variety and unpredictability
    const totalWeight = movePool.reduce((sum, m) => sum + m.weight, 0);
    let random = Math.random() * totalWeight;
    
    let finalChoice = 1;
    for (const move of movePool) {
        if (random < move.weight) {
            finalChoice = move.id;
            break;
        }
        random -= move.weight;
    }

    selectMove('p2', finalChoice);
}

function selectMove(playerStr, unitId, isRemote = false) {
    const player = playerStr === 'p1' ? p1 : p2;
    
    // Check if affordable
    if (UNITS[unitId].cost > player.energy) {
        log(`Player ${playerStr === 'p1' ? '1' : '2'} cannot afford ${UNITS[unitId].name}!`);
        return;
    }

    player.choice = unitId;
    // Only update status if not in world mode (world mode has its own status display)
    if (!isInWorld) {
        updateStatus(playerStr, "LOCKED IN", "#00ff00");
    }

    // Broadcast move to peer
    if (isOnlineMode && !isRemote) {
        socket.send(JSON.stringify({ type: 'MOVE', unitId: unitId }));
    }

    // Start "Later one lose" timer
    if (p1.choice !== null && p2.choice === null || p1.choice === null && p2.choice !== null) {
        const latePlayer = playerStr === 'p1' ? 'p2' : 'p1';
        if (isOnlineMode && !isRemote) {
            socket.send(JSON.stringify({ type: 'SYNC_TIMER', latePlayer: latePlayer }));
        }
        startPanicTimer(latePlayer);
    }

    if (p1.choice !== null && p2.choice !== null) {
        clearTimeout(turnTimer);
        document.getElementById('timer-display').innerText = "";
        resolveRound();
    }
}

function startPanicTimer(latePlayerStr, isRemote = false) {
    timeLeft = PANIC_TIME_LIMIT;
    const timerEl = document.getElementById('timer-display');
    
    const countdown = () => {
        if (p1.choice !== null && p2.choice !== null) return;
        
        timerEl.innerText = `LATE PLAYER LOSES IN: ${timeLeft}s`;
        if (timeLeft <= 0) {
            log(`Player ${latePlayerStr === 'p1' ? '1' : '2'} was too slow and loses!`);
            const loser = latePlayerStr === 'p1' ? p1 : p2;
            loser.alive = false;
            endGame();
        } else {
            timeLeft--;
            turnTimer = setTimeout(countdown, 1000);
        }
    };
    countdown();
}

function resolveRound() {
    const m1 = p1.choice;
    const m2 = p2.choice;

    log(`P1: ${UNITS[m1].name} vs P2: ${UNITS[m2].name}`);

    // Deduct costs
    p1.energy -= UNITS[m1].cost;
    p2.energy -= UNITS[m2].cost;

    // Handle Charge Logic (Unit 1)
    // In combat mode, Unit 1 adds energy. In world mode, '1' key cuts trees.
    if (!isInWorld) {
        if (m1 === 1) p1.energy++;
        if (m2 === 1) p2.energy++;
    }

    // Win/Loss logic based on your rules
    const p1KillsP2 = checkKill(m1, m2);
    const p2KillsP1 = checkKill(m2, m1);

    // --- Encouragement Logic ---
    const updateStreak = (p, move, oppMove, name) => {
        // Charge streaks (bravo! and no way!)
        if (move === 1) {
            p.chargeStreak++;
            if (p.chargeStreak === 2) {
                log(`${name}: bravo!`);
                announce("bravo!");
            }
            if (p.chargeStreak === 5) {
                log(`${name}: no way!`);
                announce("no way!");
            }
        } else {
            p.chargeStreak = 0;
        }

        // Attack streak (attacking volenly!)
        if (move >= 2 && move <= 8) {
            p.attackStreak++;
            if (p.attackStreak === 2) {
                log(`${name}: attacking volenly!`);
                announce("attacking volenly!");
            }
        } else {
            p.attackStreak = 0;
        }

        // Defend Success streak (defending with sucess!)
        // Success = Guarding (9) against Fireball (2) or Tornado (3)
        if (move === 9 && (oppMove === 2 || oppMove === 3)) {
            p.defendStreak++;
            if (p.defendStreak === 3) {
                log(`${name}: defending with sucess!`);
                announce("defending with sucess!");
            }
        } else {
            p.defendStreak = 0;
        }
    };

    updateStreak(p1, m1, m2, "Player 1");
    updateStreak(p2, m2, m1, "Player 2");
    // ---------------------------
    
    if (p1KillsP2 && p2KillsP1) {
        p1.alive = false; p2.alive = false;
        log("Double Knockout!");
        updateStatuses(`${UNITS[m1].name.toUpperCase()}: CLASH`, `${UNITS[m2].name.toUpperCase()}: CLASH`, "#ff4444");
    } else if (p1KillsP2) {
        p2.alive = false;
        log("Player 1 Wins the Round!");
        updateStatus('p1', `${UNITS[m1].name.toUpperCase()}: WIN!`, "#00ffcc");
        updateStatus('p2', `${UNITS[m2].name.toUpperCase()}: DEAD`, "#ff4444");
    } else if (p2KillsP1) {
        p1.alive = false;
        log("Player 2 Wins the Round!");
        updateStatus('p1', `${UNITS[m1].name.toUpperCase()}: DEAD`, "#ff4444");
        updateStatus('p2', `${UNITS[m2].name.toUpperCase()}: WIN!`, "#00ffcc");
    } else {
        log("Stalemate! Both survive.");
        updateStatuses(`${UNITS[m1].name.toUpperCase()}: SAFE`, `${UNITS[m2].name.toUpperCase()}: SAFE`, "#fff");
    }

    // Reset choices for next round
    updateUI();
    if (p1.alive && p2.alive) {
        roundCount++;
        setTimeout(startRound, 1500); // Faster transitions between moves
    } else {
        setTimeout(endGame, 2000); // Allow time to see the final move's result
    }
}

function checkKill(attacker, defender) {
    // Rule: 9 defends vs 2 and 3, dies to everything else (4-8)
    if (defender === 9) {
        return (attacker >= 4 && attacker <= 8);
    }

    // Rule: 1 is the money, and everything else can kill it (2-8). 9 makes both safe.
    if (defender === 1) {
        return (attacker >= 2 && attacker <= 8); 
    }

    // Standard Tiers: Higher cost units kill lower cost units
    // Units 7 and 8 are top tier.
    if (attacker === 7 || attacker === 8) {
        return defender >= 1 && defender <= 6;
    }

    // Units 2-6 kill anything lower than them
    if (attacker >= 2 && attacker <= 6) {
        return defender < attacker;
    }

    return false;
}

/**
 * Updates the UI elements for both players based on current state.
 */
function updateUI() {
    // Player 1 UI
    const p1Name = document.getElementById('p1-display-name');
    const p1Energy = document.getElementById('p1-energy');
    const p1ScoreEl = document.getElementById('p1-score');
    const p1ScoreMob = document.getElementById('p1-score-mobile');
    const p1EnergyMob = document.getElementById('p1-energy-mobile');
    const p1NameMob = document.getElementById('p1-display-name-mobile');
    
    const p1Text = (isOnlineMode && myRole === 'p2') ? "Opponent" : (currentUser || "Player 1");
    if (p1Name) p1Name.innerText = p1Text;
    if (p1NameMob) p1NameMob.innerText = p1Text;
    if (p1Energy) p1Energy.innerText = p1.energy;
    if (p1EnergyMob) p1EnergyMob.innerText = p1.energy;
    if (p1ScoreEl) p1ScoreEl.innerText = p1Score;
    if (p1ScoreMob) p1ScoreMob.innerText = p1Score;

    // Player 2 UI
    const p2Name = document.getElementById('p2-display-name');
    const p2NameMobile = document.getElementById('p2-display-name-mobile');
    const p2Energy = document.getElementById('p2-energy');
    const p2EnergyMobile = document.getElementById('p2-energy-mobile');

    const p2Text = (isOnlineMode && myRole === 'p1') ? "Opponent" : (isAIMode ? "AI Bot" : "Player 2");
    if (p2Name) p2Name.innerText = p2Text;
    if (p2NameMobile) p2NameMobile.innerText = p2Text;
    if (p2Energy) p2Energy.innerText = p2.energy;
    if (p2EnergyMobile) p2EnergyMobile.innerText = p2.energy;

    // Update Button Disabled States
    for (let id = 1; id <= 9; id++) {
        const p1Btn = document.getElementById(`p1-unit-btn-${id}`);
        if (p1Btn) p1Btn.classList.toggle('disabled', UNITS[id].cost > p1.energy);
        
        const p2Btn = document.getElementById(`p2-unit-btn-${id}`);
        const p2BtnMobile = document.getElementById(`p2-unit-btn-mobile-${id}`);
        const p1BtnMobile = document.getElementById(`p1-unit-btn-mobile-${id}`);

        if (p2Btn) p2Btn.classList.toggle('disabled', UNITS[id].cost > p2.energy);
        if (p2BtnMobile) p2BtnMobile.classList.toggle('disabled', UNITS[id].cost > p2.energy);
        if (p1BtnMobile) p1BtnMobile.classList.toggle('disabled', UNITS[id].cost > p1.energy);
    }

    // World Screen Sync
    const worldP1Energy = document.getElementById('world-p1-energy');
    if (worldP1Energy) worldP1Energy.innerText = p1.energy;
    
    const invWood = document.getElementById('inv-wood-count');
    if (invWood) invWood.innerText = `${p1.inventory.wood} / 100`;

    const worldP2Energy = document.getElementById('world-p2-energy');
    if (worldP2Energy) worldP2Energy.innerText = p2.energy;
    
    const worldP2Status = document.getElementById('world-p2-status');
    if (worldP2Status) {
        worldP2Status.classList.toggle('hidden', !(isOnlineMode && isInWorld));
    }
}

/**
 * Logs messages to all active battle log boxes (Normal and Mirrored)
 */
function log(msg, clear = false) {
    const logEl = document.getElementById('battle-log');
    if (logEl) {
        if (clear) logEl.innerHTML = "";
        logEl.innerHTML += `<div style="border-bottom: 1px solid #333; padding: 2px 0;">${msg}</div>`;
        logEl.scrollTop = logEl.scrollHeight;
    }
}

function updateStatus(player, text, color) {
    const statusEl = document.getElementById(`${player}-status`);
    const statusElMobile = document.getElementById(`${player}-status-mobile`);
    
    if (statusEl) {
        statusEl.innerText = text;
        statusEl.style.color = color;
    }
    if (statusElMobile) {
        statusElMobile.innerText = text;
        statusElMobile.style.color = color;
    }
}

function updateStatuses(p1Text, p2Text, color) {
    updateStatus('p1', p1Text, color);
    updateStatus('p2', p2Text, color);
}

async function endGame() {
    if (!p1.alive && !p2.alive) log("GAME OVER: DRAW!");
    else if (!p1.alive) log("GAME OVER: PLAYER 2 VICTORIOUS!");
    else if (!p2.alive) {
        log("GAME OVER: PLAYER 1 VICTORIOUS!");
    }

    // Award local score in Multiplayer or AI Mode
    const iWon = (myRole === 'p1' && !p2.alive) || (myRole === 'p2' && !p1.alive) || (isAIMode && !p2.alive);
    
    if (iWon) {
        p1Score += 5;
        if (currentUser) {
            await saveScoreToServer(currentUser, p1Score);
        }
    }

    log("GGs!");
    announce("GGs!");

    updateUI();
    updateStatus('p1', p1.alive ? "WINNER" : "DEAD", p1.alive ? "#00ffcc" : "#ff4444");
    updateStatus('p2', p2.alive ? "WINNER" : "DEAD", p2.alive ? "#00ffcc" : "#ff4444");
}

function isMobile() {
    return /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent) || 
           (navigator.maxTouchPoints > 0);
}

updateUI();