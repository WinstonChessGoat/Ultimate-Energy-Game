/**
 * The Ultimate Energy Game - Core Logic
 */

const PANIC_TIME_LIMIT = 1;

// Environment detection for the client
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const ENV_NAME = IS_LOCAL ? 'LOCAL' : 'PRODUCTION';

// Define your Render URL here
const RENDER_URL = 'https://ultimate-energy-game.onrender.com';

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

let p1 = { x: 0, y: 0, energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0, inventory: { wood: 0 } };
let p2 = { x: 0, y: 0, energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0, inventory: { wood: 0 } };
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
    if (socket) socket.disconnect();
    // Connect to local server if developing, otherwise connect to Render
    socket = io(IS_LOCAL ? 'http://localhost:9000' : RENDER_URL);

    socket.emit('join-room', roomId);

    socket.on('room-ready', () => {
        log("System: Connected to opponent!");
        showLoading(false);
        initGame(false);
    });

    socket.on('message', (data) => {
        const opponentRole = myRole === 'p1' ? 'p2' : 'p1';
        const opp = opponentRole === 'p1' ? p1 : p2;

        if (data.type === 'MOVE') selectMove(opponentRole, data.unitId, true);
        else if (data.type === 'RESTART') resetGame();
        else if (data.type === 'SYNC_TIMER') startPanicTimer(data.latePlayer, true);
        else if (data.type === 'POS') { opp.x = data.x; opp.y = data.y; }
        else if (data.type === 'ENERGY_UPDATE') { opp.energy = data.energy; opp.inventory.wood = data.inventoryWood; updateUI(); }
        else if (data.type === 'INVENTORY_UPDATE') { opp.inventory.wood = data.inventoryWood; updateUI(); }
    });

    socket.on('opponent-disconnected', () => {
        log("System: Connection lost.");
        alert("Opponent disconnected.");
        goToMainMenu();
    });
}

function handleCombatKeys(key) {
    if (isOnlineMode) {
        // In online mode, both players use 1-9 for their own character
        if (P2_KEYS[key] && (myRole === 'p1' ? p1 : p2).choice === null) {
            selectMove(myRole, P2_KEYS[key]);
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
        if (playerStr === myRole && (myRole === 'p1' ? p1 : p2).choice === null) selectMove(myRole, unitId);
    } else {
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
        socket.emit('message', { type: 'RESTART' });
    }
    resetGame();
}

// Expose global functions for world.js to use
window.log = log;
window.updateUI = updateUI;

function initGame(vsAI) {
    isAIMode = vsAI;
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    document.getElementById('p1-unit-guide').classList.remove('hidden');
    
    const p2Guide = document.getElementById('p2-unit-guide');
    if (!vsAI && !isOnlineMode) {
        // Local PvP: Create the rotated top row for Player 2
        p2Guide.innerHTML = document.getElementById('p1-unit-guide').innerHTML
            .replace(/p1-unit-btn/g, 'p2-unit-btn')
            .replace(/handleUnitClick\('p1'/g, "handleUnitClick('p2'");
        p2Guide.classList.remove('hidden');
    } else {
        p2Guide.classList.add('hidden');
    }
    
    const controls = document.getElementById('controls-text');
    if (isOnlineMode) {
        controls.innerText = `Online Mode | You are ${myRole.toUpperCase()} | Keys: 1-9`;
    } else if (isAIMode) {
        controls.innerText = "Player 1 Keys: 1-9 | AI Mode | Press Enter to Restart";
    } else {
        controls.innerText = "P1: 1-9 | P2: Q,W,E,R,T,Y,U,I,O | Press Enter to Restart";
    }
    
    resetGame();
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
    p1 = { x: 100, y: 200, energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0, inventory: { wood: 0 } };
    p2 = { x: 500, y: 200, energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0, inventory: { wood: 0 } };
    roundCount = 1;
    clearTimeout(turnTimer);
    clearTimeout(aiThinkingTimeout);
    document.getElementById('battle-log').innerHTML = "Welcome! Choose your units to begin.";
    document.getElementById('timer-display').innerText = "";
    updateUI();
    startRound();
}

function startRound() {
    if (!p1.alive || !p2.alive) return;
    
    p1.choice = null;
    p2.choice = null;
    
    log(`System: Round ${roundCount} Started!`);

    document.getElementById('p1-status').innerText = "Waiting...";
    document.getElementById('p2-status').innerText = isAIMode ? "AI Thinking..." : "Waiting...";
    document.getElementById('p1-status').style.color = "#888";
    document.getElementById('p2-status').style.color = "#888";

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
        document.getElementById(`${playerStr}-status`).innerText = "LOCKED IN";
        document.getElementById(`${playerStr}-status`).style.color = "#00ff00";
    }

    // Broadcast move to peer
    if (isOnlineMode && !isRemote) {
        socket.emit('message', { type: 'MOVE', unitId: unitId });
    }

    // Start "Later one lose" timer
    if (p1.choice !== null && p2.choice === null || p1.choice === null && p2.choice !== null) {
        const latePlayer = playerStr === 'p1' ? 'p2' : 'p1';
        if (isOnlineMode && !isRemote) {
            socket.emit('message', { type: 'SYNC_TIMER', latePlayer: latePlayer });
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

    const p1Status = document.getElementById('p1-status');
    const p2Status = document.getElementById('p2-status');

    if (p1KillsP2 && p2KillsP1) {
        // Mutual destruction? In this game usually means both die
        p1.alive = false; p2.alive = false;
        log("Double Knockout!");
        p1Status.innerText = `${UNITS[m1].name.toUpperCase()}: CLASH`;
        p2Status.innerText = `${UNITS[m2].name.toUpperCase()}: CLASH`;
        p1Status.style.color = p2Status.style.color = "#ff4444";
    } else if (p1KillsP2) {
        p2.alive = false;
        log("Player 1 Wins the Round!");
        p1Status.innerText = `${UNITS[m1].name.toUpperCase()}: WIN!`;
        p2Status.innerText = `${UNITS[m2].name.toUpperCase()}: DEAD`;
        p1Status.style.color = "#00ffcc";
        p2Status.style.color = "#ff4444";
    } else if (p2KillsP1) {
        p1.alive = false;
        log("Player 2 Wins the Round!");
        p1Status.innerText = `${UNITS[m1].name.toUpperCase()}: DEAD`;
        p2Status.innerText = `${UNITS[m2].name.toUpperCase()}: WIN!`;
        p1Status.style.color = "#ff4444";
        p2Status.style.color = "#00ffcc";
    } else {
        log("Stalemate! Both survive.");
        p1Status.innerText = `${UNITS[m1].name.toUpperCase()}: SAFE`;
        p2Status.innerText = `${UNITS[m2].name.toUpperCase()}: SAFE`;
        p1Status.style.color = p2Status.style.color = "#fff";
    }

    // Reset choices for next round
    updateUI();
    if (p1.alive && p2.alive) {
        roundCount++;
        setTimeout(startRound, 1500); // Faster transitions between moves
    } else {
        endGame();
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

function updateUI() {
    // Refresh Dashboard Buttons (Affordability)
    const players = { p1, p2 };
    ['p1', 'p2'].forEach(pKey => {
        for (let id = 1; id <= 9; id++) {
            const btn = document.getElementById(`${pKey}-unit-btn-${id}`);
            if (btn) {
                if (UNITS[id].cost > players[pKey].energy) btn.classList.add('disabled');
                else btn.classList.remove('disabled');
            }
        }
    });

    // Update game-screen UI elements
    const p1EnergyEl = document.getElementById('p1-energy');
    if (p1EnergyEl) p1EnergyEl.innerText = p1.energy;
    const p2EnergyEl = document.getElementById('p2-energy');
    if (p2EnergyEl) p2EnergyEl.innerText = p2.energy;
    const scoreEl = document.getElementById('p1-score');
    if (scoreEl) scoreEl.innerText = p1Score;

    // Update world-screen UI elements
    const worldP1EnergyEl = document.getElementById('world-p1-energy');
    if (worldP1EnergyEl) worldP1EnergyEl.innerText = p1.energy;
    const worldP1InventoryWoodEl = document.getElementById('world-p1-inventory-wood');
    if (worldP1InventoryWoodEl) worldP1InventoryWoodEl.innerText = p1.inventory.wood;

    const worldP2EnergyEl = document.getElementById('world-p2-energy');
    if (worldP2EnergyEl) worldP2EnergyEl.innerText = p2.energy;
    const worldP2StatusEl = document.getElementById('world-p2-status');
    if (worldP2StatusEl) {
        if (isOnlineMode && isInWorld) {
            worldP2StatusEl.classList.remove('hidden');
        } else {
            worldP2StatusEl.classList.add('hidden');
        }
    }
}

function log(msg) {
    const logEl = document.getElementById('battle-log');
    // Appending ensures the newest result is at the bottom
    logEl.innerHTML += `<div style="border-bottom: 1px solid #333; padding: 2px 0;">${msg}</div>`;
    // Force scroll to bottom so the latest result is always visible
    logEl.scrollTop = logEl.scrollHeight;
}

function endGame() {
    if (!p1.alive && !p2.alive) log("GAME OVER: DRAW!");
    else if (!p1.alive) log("GAME OVER: PLAYER 2 VICTORIOUS!");
    else if (!p2.alive) {
        log("GAME OVER: PLAYER 1 VICTORIOUS!");
    }

    // Award local score in Multiplayer or AI Mode
    if ((!p2.alive && (isAIMode || (isOnlineMode && myRole === 'p1'))) || 
        (!p1.alive && (isOnlineMode && myRole === 'p2'))) {
        if (isAIMode) {
            p1Score += 5;
            if (currentUser) {
                localStorage.setItem(`ultimate_energy_score_${currentUser}`, p1Score);
            }
        }
    }

    log("GGs!");
    announce("GGs!");

    updateUI();
    document.getElementById('p1-status').innerText = p1.alive ? "WINNER" : "DEAD";
    document.getElementById('p2-status').innerText = p2.alive ? "WINNER" : "DEAD";
}

updateUI();