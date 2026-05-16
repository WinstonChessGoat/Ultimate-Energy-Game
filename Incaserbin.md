game.js:

/**
 * The Ultimate Energy Game - Core Logic
 */

const PANIC_TIME_LIMIT = 1;

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

let p1 = { energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0 };
let p2 = { energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0 };
let p1Score = 0;
let currentUser = null;
let turnTimer = null;
let timeLeft = PANIC_TIME_LIMIT;
let aiThinkingTimeout = null;
let isAIMode = true;

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    if (!p1.alive || !p2.alive) {
        if (key === 'enter') resetGame();
        return;
    }

    if (P1_KEYS[key] && p1.choice === null) {
        selectMove('p1', P1_KEYS[key]);
    } else if (!isAIMode && P2_KEYS[key] && p2.choice === null) {
        selectMove('p2', P2_KEYS[key]);
    }
});

function handleSignIn() {
    const input = document.getElementById('username-input');
    const name = input.value.trim();
    if (!name) return;

    currentUser = name;
    const savedData = localStorage.getItem(`ultimate_energy_score_${currentUser}`);
    p1Score = savedData ? parseInt(savedData) : 0;

    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
    document.getElementById('p1-display-name').innerText = currentUser;
    updateUI();
}

function initGame(vsAI) {
    isAIMode = vsAI;
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    document.getElementById('unit-guide').classList.remove('hidden');
    
    const controls = document.getElementById('controls-text');
    if (isAIMode) {
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
    document.getElementById('unit-guide').classList.add('hidden');
}

function resetGame() {
    p1 = { energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0 };
    p2 = { energy: 0, choice: null, alive: true, chargeStreak: 0, attackStreak: 0, defendStreak: 0 };
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

function selectMove(playerStr, unitId) {
    const player = playerStr === 'p1' ? p1 : p2;
    
    // Check if affordable
    if (UNITS[unitId].cost > player.energy) {
        log(`Player ${playerStr === 'p1' ? '1' : '2'} cannot afford ${UNITS[unitId].name}!`);
        return;
    }

    player.choice = unitId;
    document.getElementById(`${playerStr}-status`).innerText = "LOCKED IN";
    document.getElementById(`${playerStr}-status`).style.color = "#00ff00";

    // Start "Later one lose" timer
    if (p1.choice !== null && p2.choice === null || p1.choice === null && p2.choice !== null) {
        startPanicTimer(playerStr === 'p1' ? 'p2' : 'p1');
    }

    if (p1.choice !== null && p2.choice !== null) {
        clearTimeout(turnTimer);
        document.getElementById('timer-display').innerText = "";
        resolveRound();
    }
}

function startPanicTimer(latePlayerStr) {
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

    // Reveal choices in the UI
    document.getElementById('p1-status').innerText = UNITS[m1].name.toUpperCase();
    document.getElementById('p2-status').innerText = UNITS[m2].name.toUpperCase();
    document.getElementById('p1-status').style.color = "#fff";
    document.getElementById('p2-status').style.color = "#fff";

    log(`P1: ${UNITS[m1].name} vs P2: ${UNITS[m2].name}`);

    // Deduct costs
    p1.energy -= UNITS[m1].cost;
    p2.energy -= UNITS[m2].cost;

    // Handle Charge Logic (Unit 1)
    if (m1 === 1) p1.energy++;
    if (m2 === 1) p2.energy++;

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
        // Mutual destruction? In this game usually means both die
        p1.alive = false; p2.alive = false;
        log("Double Knockout!");
    } else if (p1KillsP2) {
        p2.alive = false;
        log("Player 1 Wins the Round!");
    } else if (p2KillsP1) {
        p1.alive = false;
        log("Player 2 Wins the Round!");
    } else {
        log("Stalemate! Both survive.");
    }

    // Reset choices for next round
    updateUI();
    if (p1.alive && p2.alive) {
        setTimeout(startRound, 1500); // Faster transitions between moves
    } else {
        endGame();
    }
}

function checkKill(attacker, defender) {
    // Rule: 9 defends vs 2 and 3, dies to everything else (4-8)
    if (defender === 9) {
        if (attacker >= 4 && attacker <= 8) return true;
        return false;
    }

    // Rule: 1 killed by everything except 1 and 9
    if (defender === 1) {
        if (attacker >= 2 && attacker <= 8) return true;
        return false;
    }

    // Unit 2 kills 1
    if (attacker === 2 && defender === 1) return true;
    // Unit 3 kills 1, 2
    if (attacker === 3 && [1, 2].includes(defender)) return true;
    // Unit 4 kills 1-3
    if (attacker === 4 && defender >= 1 && defender <= 3) return true;
    // Unit 5 kills 1-4
    if (attacker === 5 && defender >= 1 && defender <= 4) return true;
    // Unit 6 kills 1-5
    if (attacker === 6 && defender >= 1 && defender <= 5) return true;
    // Unit 7 & 8 kills 1-6
    if ((attacker === 7 || attacker === 8) && defender >= 1 && defender <= 6) return true;

    return false;
}

function updateUI() {
    document.getElementById('p1-energy').innerText = p1.energy;
    document.getElementById('p2-energy').innerText = p2.energy;
    const scoreEl = document.getElementById('p1-score');
    if (scoreEl) scoreEl.innerText = p1Score;
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

function announce(text) {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.pitch = 1.2; // Slightly higher pitch for excitement
        utterance.rate = 1.1;  // Slightly faster pace
        window.speechSynthesis.speak(utterance);
    }
}

updateUI();


index.html:

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>The Ultimate Energy Game</title>
    <style>
        body {
            background: #121212;
            color: white;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
        }
        #auth-screen {
            text-align: center;
            background: #1e1e1e;
            padding: 40px;
            border-radius: 15px;
            border: 2px solid #ffcc00;
        }
        #auth-screen input {
            padding: 12px;
            border-radius: 5px;
            border: 1px solid #444;
            background: #121212;
            color: white;
            font-size: 1.1em;
            margin: 15px 0;
            width: 250px;
            display: block;
            text-align: center;
            margin-left: auto;
            margin-right: auto;
        }
        #menu-screen {
            text-align: center;
            background: #1e1e1e;
            padding: 40px;
            border-radius: 15px;
            border: 2px solid #00ffcc;
        }
        .menu-btn {
            background: #00ffcc;
            color: black;
            border: none;
            padding: 15px 30px;
            font-size: 1.2em;
            font-weight: bold;
            margin: 10px;
            border-radius: 5px;
            cursor: pointer;
            transition: transform 0.2s;
        }
        .menu-btn:hover { transform: scale(1.05); background: #00cca3; }
        
        #main-arena {
            display: flex;
            align-items: flex-start;
            gap: 30px;
            margin-top: 20px;
        }

        #game-container {
            display: flex;
            gap: 20px;
            text-align: center;
        }

        .player-box {
            border: 2px solid #444;
            padding: 20px;
            border-radius: 10px;
            width: 200px;
        }
        .energy-count { font-size: 2em; color: #00ffcc; }
        .status { margin-top: 10px; font-style: italic; color: #888; }

        #log-container {
            display: flex;
            flex-direction: column;
            text-align: left;
        }
        .log-header {
            font-size: 0.8em;
            color: #00ffcc;
            margin-bottom: 5px;
            font-weight: bold;
            text-transform: uppercase;
        }
        #battle-log {
            height: 320px;
            width: 300px;
            overflow-y: auto;
            background: #1e1e1e;
            padding: 10px;
            border-radius: 5px;
            border: 2px solid #333;
            font-size: 0.9em;
            line-height: 1.4;
        }
        #timer-display {
            font-size: 1.5em;
            color: #ff4444;
            height: 30px;
            margin-bottom: 10px;
        }
        .controls { color: #aaa; font-size: 0.8em; margin-top: 20px; }
        .hidden { display: none !important; }
        
        #game-screen {
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        #unit-guide {
            margin-top: 30px;
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 15px;
            max-width: 800px;
        }
        .unit-card {
            background: #1e1e1e;
            padding: 10px;
            border-radius: 5px;
            border: 1px solid #333;
            font-size: 0.85em;
        }
        .unit-card span { display: block; color: #00ffcc; font-weight: bold; }
        .unit-card small { color: #888; }
    </style>
</head>
<body>
    <h1>ULTIMATE ENERGY</h1>

    <div id="auth-screen">
        <h2>Sign In</h2>
        <p style="color: #888;">Enter a username to save your score</p>
        <input type="text" id="username-input" placeholder="Your Name">
        <button class="menu-btn" style="background: #ffcc00;" onclick="handleSignIn()">Sign In</button>
    </div>

    <div id="menu-screen" class="hidden">
        <h2>Select Game Mode</h2>
        <button class="menu-btn" onclick="initGame(true)">VS AI</button>
        <button class="menu-btn" onclick="initGame(false)">VS Player 2</button>
    </div>
    
    <div id="game-screen" class="hidden">
        <div id="timer-display"></div>
        
        <div id="main-arena">
            <div id="game-container">
                <div class="player-box" id="p1-box">
                    <h2 id="p1-display-name">Player 1</h2>
                    <div style="color: #ffcc00; font-weight: bold;">Score: <span id="p1-score">0</span></div>
                    <div class="energy-count" id="p1-energy">0</div>
                    <div class="status" id="p1-status">Waiting...</div>
                </div>
                
                <div class="player-box" id="p2-box">
                    <h2>Player 2</h2>
                    <div class="energy-count" id="p2-energy">0</div>
                    <div class="status" id="p2-status">Waiting...</div>
                </div>
            </div>

            <div id="log-container">
                <div class="log-header">Battle Record</div>
                <div id="battle-log">Welcome! Choose your units to begin.</div>
            </div>
        </div>

        <div class="controls" id="controls-text">
            Player 1 Keys: 1-9 | Press Enter to Restart
        </div>
        <button class="menu-btn" style="background: #ff4444; margin-top: 20px;" onclick="goToMenu()">Back to Menu</button>
    </div>

    <div id="unit-guide" class="hidden">
        <div class="unit-card">
            <span>1. Charge</span>
            <small>Cost: 0 | P1: [1] | P2: [Q]</small>
        </div>
        <div class="unit-card">
            <span>2. Fireball</span>
            <small>Cost: 1 | P1: [2] | P2: [W]</small>
        </div>
        <div class="unit-card">
            <span>3. Tornado</span>
            <small>Cost: 2 | P1: [3] | P2: [E]</small>
        </div>
        <div class="unit-card">
            <span>4. Earthquake</span>
            <small>Cost: 3 | P1: [4] | P2: [R]</small>
        </div>
        <div class="unit-card">
            <span>5. Tsunami</span>
            <small>Cost: 4 | P1: [5] | P2: [T]</small>
        </div>
        <div class="unit-card">
            <span>6. Blackhole</span>
            <small>Cost: 5 | P1: [6] | P2: [Y]</small>
        </div>
        <div class="unit-card">
            <span>7. Megashield</span>
            <small>Cost: 10 | P1: [7] | P2: [U]</small>
        </div>
        <div class="unit-card">
            <span>8. Ultimate</span>
            <small>Cost: 12 | P1: [8] | P2: [I]</small>
        </div>
        <div class="unit-card">
            <span>9. Guard</span>
            <small>Cost: 0 | P1: [9] | P2: [O]</small>
        </div>
        <div class="unit-card" style="border-color: #ff4444;">
            <span>Restart</span>
            <small>Key: [Enter]</small>
        </div>
    </div>

    <script src="game.js"></script>
</body>
</html>