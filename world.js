/**
 * Infinite Forest World Engine
 */
// Access global game state from game.js
/* global p1, p2, p1Score, currentUser, isInWorld, isOnlineMode, myRole, conn, log, updateUI */

// Canvas setup
const worldCanvas = document.getElementById('worldCanvas');
const worldCtx = worldCanvas.getContext('2d');

const CHUNK_SIZE = 400; // Pixels per chunk
const TREE_DENSITY = 0.12; // Percentage of cells that will have a tree
const PLAYER_SPEED = 3; // Pixels per frame
const CELL_SIZE = 25; // Size of a grid cell for tree placement

let movement = { w: false, a: false, s: false, d: false };
let destroyedTrees = new Set(); // Stores coordinates of cut trees
let woodDrops = []; // Stores active wood drops
let bearOffsets = {}; // Persistent offsets for moving bears
let killedBears = new Set(); // Stores coordinates of killed bears
let protectiveCircleTimer = 0; // Remaining frames for the shield
let lastTapTime = 0; // Track timing for mobile double-taps

// Procedural hash function for deterministic tree placement across chunks
function worldHash(x, y) {
    // Using a larger prime and a different seed for better distribution
    const h = Math.sin(x * 12345.6789 + y * 98765.4321 + 54321) * 43758.5453123;
    return h - Math.floor(h);
}

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (isInWorld) { // Only process these keys if in world mode
        movement[key] = true;
        if (key === 'b') {
            harvestAtPlayerPos();
        }
        if (key === 'i') {
            toggleInventoryUI();
        }
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (isInWorld && movement[key] !== undefined) {
        movement[key] = false;
    }
});

/**
 * Joystick Controller Logic
 */
const joystickContainer = document.getElementById('joystick-container');
const joystickHandle = document.getElementById('joystick-handle');
let joystickActive = false;
let joystickOrigin = { x: 0, y: 0 };

if (joystickContainer) {
    const startJoystick = (e) => {
        joystickActive = true;
        const touch = e.touches ? e.touches[0] : e;
        const rect = joystickContainer.getBoundingClientRect();
        joystickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        updateJoystick(touch.clientX, touch.clientY);
    };

    const moveJoystick = (e) => {
        if (!joystickActive) return;
        const touch = e.touches ? e.touches[0] : e;
        updateJoystick(touch.clientX, touch.clientY);
    };

    const stopJoystick = () => {
        joystickActive = false;
        joystickHandle.style.transform = `translate(-50%, -50%)`;
        movement.w = movement.a = movement.s = movement.d = false;
    };

    const updateJoystick = (clientX, clientY) => {
        const dx = clientX - joystickOrigin.x;
        const dy = clientY - joystickOrigin.y;
        const dist = Math.hypot(dx, dy);
        const maxDist = 40;
        const limitedDist = Math.min(dist, maxDist);
        const angle = Math.atan2(dy, dx);
        const moveX = Math.cos(angle) * limitedDist;
        const moveY = Math.sin(angle) * limitedDist;
        joystickHandle.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;

        const deadzone = 10;
        movement.a = dx < -deadzone;
        movement.d = dx > deadzone;
        movement.w = dy < -deadzone;
        movement.s = dy > deadzone;
    };

    joystickContainer.addEventListener('touchstart', startJoystick);
    window.addEventListener('touchmove', moveJoystick, { passive: false });
    window.addEventListener('touchend', stopJoystick);
}

worldCanvas.addEventListener('dblclick', (e) => {
    if (isInWorld) {
        toggleInventoryUI();
    }
});

/**
 * Universal input start for Mouse and Touch
 */
function handleWorldInputStart(e) {
    if (!isInWorld || (e.target !== worldCanvas && !e.touches)) return;

    if (e.touches || e.button === 0) {
        // Detect mobile double tap to toggle inventory
        if (e.touches) {
            const now = Date.now();
            if (now - lastTapTime < 300 && now - lastTapTime > 0) {
                toggleInventoryUI();
                lastTapTime = 0;
                return; // Stop processing world interaction on the second tap
            }
            lastTapTime = now;
        }

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const rect = worldCanvas.getBoundingClientRect();
        const localPlayer = myRole === 'p1' ? p1 : p2;
        const worldX = (clientX - rect.left) + (localPlayer.x - worldCanvas.width / 2);
        const worldY = (clientY - rect.top) + (localPlayer.y - worldCanvas.height / 2);

        handleWorldInteraction(worldX, worldY);
    }
}

function handleWorldInteraction(worldX, worldY) {
    const localPlayer = myRole === 'p1' ? p1 : p2;
    const treeBroken = breakTreeAtClick(worldX, worldY);

    if (!treeBroken && localPlayer.inventory.wood > 0 && protectiveCircleTimer <= 0) {
        localPlayer.inventory.wood--;
        localPlayer.energy = Math.max(0, localPlayer.energy - 1);
        protectiveCircleTimer = 300; // 5 seconds at 60fps
        log("System: Protective circle activated! -1 Wood");
        updateUI();
        
        if (isOnlineMode && conn) {
            conn.send({ type: 'INVENTORY_UPDATE', inventoryWood: localPlayer.inventory.wood });
            conn.send({ type: 'ENERGY_UPDATE', energy: localPlayer.energy });
        }
    }
}

worldCanvas.addEventListener('mousedown', handleWorldInputStart);
worldCanvas.addEventListener('touchstart', (e) => {
    if (isInWorld) {
        handleWorldInputStart(e);
    }
}, { passive: false });

/**
 * Toggles the visibility of the inventory UI and updates the counts.
 */
function toggleInventoryUI() {
    const invBox = document.getElementById('inventory-overlay-box');
    if (!invBox) return;

    const isHidden = invBox.classList.contains('hidden');
    if (isHidden) {
        const localPlayer = myRole === 'p1' ? p1 : p2;
        document.getElementById('inv-wood-count').innerText = `${localPlayer.inventory.wood} / 100`;
        invBox.classList.remove('hidden');
    } else {
        invBox.classList.add('hidden');
    }
}

/**
 * Draws a human character with simple animation
 */
function drawHuman(x, y, color, isMoving) {
    worldCtx.save();
    worldCtx.translate(x, y);

    const bob = isMoving ? Math.sin(Date.now() / 150) * 3 : 0;
    const legSwing = isMoving ? Math.sin(Date.now() / 150) * 6 : 0;

    // Legs
    worldCtx.fillStyle = '#222';
    worldCtx.fillRect(-5, 2 + legSwing, 4, 10);
    worldCtx.fillRect(1, 2 - legSwing, 4, 10);

    // Torso
    worldCtx.fillStyle = color;
    worldCtx.fillRect(-7, -15 + bob, 14, 18);

    // Head
    worldCtx.fillStyle = '#ffdbac';
    worldCtx.beginPath();
    worldCtx.arc(0, -22 + bob, 6, 0, Math.PI * 2);
    worldCtx.fill();

    // Arms
    worldCtx.fillStyle = color;
    worldCtx.fillRect(-11, -13 + bob - legSwing/2, 4, 10);
    worldCtx.fillRect(7, -13 + bob + legSwing/2, 4, 10);

    worldCtx.restore();
}

/**
 * Renders a specific chunk based on world coordinates
 */
function drawChunk(cx, cy, camX, camY) { // Added camX, camY for camera offset
    const startX = cx * CHUNK_SIZE;
    const startY = cy * CHUNK_SIZE;

    for (let x = 0; x < CHUNK_SIZE; x += CELL_SIZE) {
        for (let y = 0; y < CHUNK_SIZE; y += CELL_SIZE) {
            const worldX = startX + x;
            const worldY = startY + y;
            
            if (worldHash(worldX, worldY) < TREE_DENSITY && !destroyedTrees.has(`${worldX},${worldY}`)) {
                const screenX = worldX - camX; // Draw relative to camera
                const screenY = worldY - camY;

                // Artificial Tree Design
                // Trunk
                worldCtx.fillStyle = '#5C4033';
                worldCtx.fillRect(screenX - 4, screenY, 8, 15);

                // Leaf layers (stylized artificial look)
                worldCtx.fillStyle = '#2d5a27';
                // Bottom layer
                worldCtx.beginPath();
                worldCtx.moveTo(screenX - 18, screenY);
                worldCtx.lineTo(screenX + 18, screenY);
                worldCtx.lineTo(screenX, screenY - 22);
                worldCtx.fill();
                // Middle layer
                worldCtx.beginPath();
                worldCtx.moveTo(screenX - 14, screenY - 10);
                worldCtx.lineTo(screenX + 14, screenY - 10);
                worldCtx.lineTo(screenX, screenY - 28);
                worldCtx.fill();
                // Top layer
                worldCtx.beginPath();
                worldCtx.moveTo(screenX - 10, screenY - 20);
                worldCtx.lineTo(screenX + 10, screenY - 20);
                worldCtx.lineTo(screenX, screenY - 35);
                worldCtx.fill();
            }
        }
    }
}

/**
 * Draws all active wood drops.
 */
function drawWoodDrops(camX, camY) {
    worldCtx.fillStyle = '#8b4513'; // Brown for wood
    woodDrops.forEach(drop => {
        worldCtx.fillRect(drop.x - 5 - camX, drop.y - 5 - camY, 10, 10);
    });
}

/**
 * Draws a bear character
 */
function drawBear(x, y) {
    worldCtx.save();
    worldCtx.translate(x, y);
    worldCtx.fillStyle = '#5C4033'; // Dark brown
    // Body
    worldCtx.beginPath();
    worldCtx.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
    worldCtx.fill();
    // Head
    worldCtx.beginPath();
    worldCtx.arc(12, -5, 8, 0, Math.PI * 2);
    worldCtx.fill();
    // Ears
    worldCtx.beginPath();
    worldCtx.arc(8, -12, 3, 0, Math.PI * 2);
    worldCtx.arc(16, -12, 3, 0, Math.PI * 2);
    worldCtx.fill();
    worldCtx.restore();
}

/**
 * Harvests a tree at the player's current position.
 */
function harvestAtPlayerPos() {
    const localPlayer = myRole === 'p1' ? p1 : p2;
    breakTreeAtClick(localPlayer.x, localPlayer.y);
}

/**
 * Attempts to break a tree at the given world coordinates.
 * Returns true if a tree was broken, false otherwise.
 */
function breakTreeAtClick(worldX, worldY) {
    const localPlayer = myRole === 'p1' ? p1 : p2;
    
    // Distance check: cannot break trees too far away
    const dist = Math.hypot(localPlayer.x - worldX, localPlayer.y - worldY);
    if (dist > 100) return false; // Increased range slightly for easier clicking

    // Find the tile coordinates for the click
    const clickTileX = Math.floor(worldX / CELL_SIZE);
    const clickTileY = Math.floor(worldY / CELL_SIZE);

    // Check a small area around the click for a tree base
    for (let dy = 0; dy <= 2; dy++) { // Check the tile clicked and up to 2 tiles below for the tree base
        const tx = clickTileX * CELL_SIZE;
        const ty = (clickTileY + dy) * CELL_SIZE;

        if (worldHash(tx, ty) < TREE_DENSITY && !destroyedTrees.has(`${tx},${ty}`)) {
            destroyedTrees.add(`${tx},${ty}`);
            woodDrops.push({ x: tx + CELL_SIZE / 2, y: ty + CELL_SIZE / 2, amount: 1 });
            log("System: Tree broken!");
            return true; // Tree was broken
        }
    }
    return false; // No tree was broken
}

/**
 * Updates bear AI and handles collisions per chunk.
 */
function handleBear(cx, cy, camX, camY, localPlayer) {
    // 15% chance per chunk to have a bear
    if (worldHash(cx + 500, cy + 500) < 0.15 && !killedBears.has(`${cx},${cy}`)) {
        const bBaseX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
        const bBaseY = cy * CHUNK_SIZE + CHUNK_SIZE / 2;
        
        if (!bearOffsets[`${cx},${cy}`]) bearOffsets[`${cx},${cy}`] = {x: 0, y: 0};
        const offset = bearOffsets[`${cx},${cy}`];
        const bX = bBaseX + offset.x;
        const bY = bBaseY + offset.y;
        
        const distToPlayer = Math.hypot(localPlayer.x - bX, localPlayer.y - bY);
        
        if (distToPlayer < 200) { // Detection range
            const angle = Math.atan2(localPlayer.y - bY, localPlayer.x - bX);
            offset.x += Math.cos(angle) * 2.5; // Bear speed
            offset.y += Math.sin(angle) * 2.5;
        }
        
        // Collision detection
        if (protectiveCircleTimer > 0 && distToPlayer < 50 + 15) {
            killedBears.add(`${cx},${cy}`);
            log("System: Bear killed by protective circle!");
        } else if (distToPlayer < 12 + 15) {
            log("System: A bear caught you! Teleporting and losing wood...");
            localPlayer.x = myRole === 'p1' ? 100 : 500;
            localPlayer.y = 200;
            localPlayer.inventory.wood = 0;
            localPlayer.energy = 0;
            updateUI();
            if (isOnlineMode && conn) {
                conn.send({ type: 'POS', x: localPlayer.x, y: localPlayer.y });
                conn.send({ type: 'INVENTORY_UPDATE', inventoryWood: 0 });
                conn.send({ type: 'ENERGY_UPDATE', energy: 0 });
            }
        }
        
        drawBear(bX - camX, bY - camY);
    }
}

function worldLoop() {
    if (!isInWorld) {
        requestAnimationFrame(worldLoop);
        return;
    }

    if (protectiveCircleTimer > 0) protectiveCircleTimer--;

    const localPlayer = myRole === 'p1' ? p1 : p2;
    const opponentPlayer = myRole === 'p1' ? p2 : p1;

    let moved = false;
    if (movement.w) { localPlayer.y -= PLAYER_SPEED; moved = true; }
    if (movement.s) { localPlayer.y += PLAYER_SPEED; moved = true; }
    if (movement.a) { localPlayer.x -= PLAYER_SPEED; moved = true; }
    if (movement.d) { localPlayer.x += PLAYER_SPEED; moved = true; }

    // Clamp player position (arbitrary bounds for visual stability, world is infinite conceptually)
    localPlayer.x = Math.max(-10000, Math.min(10000, localPlayer.x));
    localPlayer.y = Math.max(-10000, Math.min(10000, localPlayer.y));

    if (moved && isOnlineMode && conn) {
        conn.send({ type: 'POS', x: localPlayer.x, y: localPlayer.y });
    }

    // Clear canvas
    worldCtx.fillStyle = '#0a2f0a';
    worldCtx.fillRect(0, 0, worldCanvas.width, worldCanvas.height);

    // Camera is centered on the local player (first-person perspective)
    const camX = localPlayer.x - worldCanvas.width / 2;
    const camY = localPlayer.y - worldCanvas.height / 2;

    // Draw visible chunks (trees)
    const viewLeft = Math.floor(camX / CHUNK_SIZE);
    const viewRight = Math.ceil((camX + worldCanvas.width) / CHUNK_SIZE);
    const viewTop = Math.floor(camY / CHUNK_SIZE);
    const viewBottom = Math.ceil((camY + worldCanvas.height) / CHUNK_SIZE);

    for (let cx = viewLeft; cx <= viewRight; cx++) {
        for (let cy = viewTop; cy <= viewBottom; cy++) {
            drawChunk(cx, cy, camX, camY);
            handleBear(cx, cy, camX, camY, localPlayer);
        }
    }

    // Draw wood drops and handle collection
    woodDrops = woodDrops.filter(drop => {
        const dist = Math.hypot(localPlayer.x - drop.x, localPlayer.y - drop.y);
        if (dist < 20) { // Player steps on wood drop
            localPlayer.inventory.wood = Math.min(100, localPlayer.inventory.wood + drop.amount);
            localPlayer.energy = Math.min(100, localPlayer.energy + drop.amount);

            // Exchange 20 wood for 5 points
            if (localPlayer.inventory.wood >= 20) {
                localPlayer.inventory.wood -= 20;
                p1Score += 5;
                log("System: 20 Wood exchanged for 5 points!");
                if (currentUser) {
                    localStorage.setItem(`ultimate_energy_score_${currentUser}`, p1Score);
                }
            }

            updateUI(); // Update game UI
            log(`System: Collected ${drop.amount} wood!`);
            if (isOnlineMode && conn) {
                conn.send({ type: 'INVENTORY_UPDATE', inventoryWood: localPlayer.inventory.wood });
                conn.send({ type: 'ENERGY_UPDATE', energy: localPlayer.energy });
            }
            return false; // Remove collected drop
        }
        return true; // Keep uncollected drops
    });
    drawWoodDrops(camX, camY);

    // Draw Protective Circle
    if (protectiveCircleTimer > 0) {
        worldCtx.strokeStyle = 'rgba(0, 255, 204, 0.6)';
        worldCtx.lineWidth = 4;
        worldCtx.beginPath();
        worldCtx.arc(worldCanvas.width / 2, worldCanvas.height / 2, 50, 0, Math.PI * 2);
        worldCtx.stroke();
    }

    // Draw players
    drawHuman(worldCanvas.width / 2, worldCanvas.height / 2, '#00ffcc', moved); // Local player is always in center
    if (isOnlineMode) {
        // Draw opponent relative to local player's camera
        drawHuman(opponentPlayer.x - camX, opponentPlayer.y - camY, '#ff4444', false);
    }

    requestAnimationFrame(worldLoop);
}

worldLoop();