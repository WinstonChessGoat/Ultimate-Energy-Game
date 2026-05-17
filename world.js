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
const ROTATION_SPEED = 0.05; // Radians per frame
const CELL_SIZE = 25; // Size of a grid cell for tree placement
const HARVEST_TIME_REQUIRED = 180; // 3 seconds at 60fps

let movement = { w: false, a: false, s: false, d: false };
let destroyedTrees = new Set(); // Stores coordinates of cut trees
let woodDrops = []; // Stores active wood drops
let bearOffsets = {}; // Persistent offsets for moving bears
let killedBears = new Set(); // Stores coordinates of killed bears
let protectiveCircleTimer = 0; // Remaining frames for the shield
let lastTapTime = 0; // Track timing for mobile double-taps
let harvestTimer = 0; // Current progress on cutting a tree
let currentHarvestTarget = null; // Coordinates of tree being cut
let playerAngle = 0; // Player's horizontal orientation

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
 * Floating Joystick Controller Logic
 */
const joystickContainer = document.getElementById('joystick-container');
const joystickHandle = document.getElementById('joystick-handle');
const worldScreen = document.getElementById('world-screen');
let joystickActive = false;
let joystickOrigin = { x: 0, y: 0 };

if (worldScreen && joystickContainer) {
    worldScreen.addEventListener('touchstart', (e) => {
        if (!isInWorld) return;
        const touch = e.touches[0];
        // Only spawn joystick on the left half of the screen
        if (touch.clientX < window.innerWidth / 2) {
            joystickActive = true;
            joystickOrigin = { x: touch.clientX, y: touch.clientY };
            joystickContainer.style.display = 'block';
            joystickContainer.style.left = `${joystickOrigin.x - 55}px`;
            joystickContainer.style.top = `${joystickOrigin.y - 55}px`;
            updateJoystick(touch.clientX, touch.clientY);
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (!joystickActive) return;
        e.preventDefault(); // Stop page scrolling while moving
        const touch = e.touches[0];
        updateJoystick(touch.clientX, touch.clientY);
    }, { passive: false });

    window.addEventListener('touchend', () => {
        if (!joystickActive) return;
        joystickActive = false;
        joystickContainer.style.display = 'none';
        joystickHandle.style.transform = `translate(-50%, -50%)`;
        movement.w = movement.a = movement.s = movement.d = false;
    });
}

function updateJoystick(clientX, clientY) {
    const dx = clientX - joystickOrigin.x;
    const dy = clientY - joystickOrigin.y;
    const dist = Math.hypot(dx, dy);
    const maxDist = 45;
    const limitedDist = Math.min(dist, maxDist);
    const angle = Math.atan2(dy, dx);
    const moveX = Math.cos(angle) * limitedDist;
    const moveY = Math.sin(angle) * limitedDist;
    joystickHandle.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;

    const deadzone = 10;
    movement.a = dx < -deadzone; // Rotation
    movement.d = dx > deadzone; // Rotation
    movement.w = dy < -deadzone; // Forward
    movement.s = dy > deadzone; // Backward
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
        movement.b = true; // Simulate holding B for harvesting
        // Detect mobile double tap to toggle inventory
        if (e.touches) {
            const touch = e.touches[0];
            // If the touch is on the left side, it's for movement; ignore it here
            if (touch.clientX < window.innerWidth / 2) return;

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

function handleWorldInputEnd() {
    movement.b = false;
    harvestTimer = 0;
    currentHarvestTarget = null;
}

function handleWorldInteraction(worldX, worldY) {
    // In First POV, we interact with what's in front of us.
    // Interaction logic is now handled inside the worldLoop.
}

worldCanvas.addEventListener('mousedown', handleWorldInputStart);
window.addEventListener('mouseup', handleWorldInputEnd);
worldCanvas.addEventListener('touchstart', (e) => {
    if (isInWorld) handleWorldInputStart(e);
}, { passive: false });
window.addEventListener('touchend', handleWorldInputEnd);

/**
 * Projects a world coordinate to screen space for 3D effect
 */
function project(worldX, worldY, playerX, playerY, angle) {
    const localPlayer = myRole === 'p1' ? p1 : p2;
    const dx = worldX - playerX;
    const dy = worldY - playerY;
    const rotX = dx * Math.cos(-angle) - dy * Math.sin(-angle);
    const rotY = dx * Math.sin(-angle) + dy * Math.cos(-angle);
    return { x: rotX, y: rotY, dist: rotX }; // x is depth, y is horizontal in First POV
}

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
 * Renders a tree with 3D perspective
 */
function drawTree3D(screenX, scale) {
    const trunkW = 20 * scale;
    const trunkH = 60 * scale;
    const leafW = 80 * scale;

    const x = worldCanvas.width / 2 + screenX;
    const y = worldCanvas.height / 2 + 50 * scale; // Ground level relative to horizon

    // Trunk
    worldCtx.fillStyle = '#5C4033';
    worldCtx.fillRect(x - trunkW / 2, y, trunkW, trunkH);

    // Foliage (Cone layers)
    worldCtx.fillStyle = '#2d5a27';
    for (let i = 0; i < 3; i++) {
        const layerY = y - (i * 30 * scale);
        const layerW = leafW * (1 - i * 0.2);
        worldCtx.beginPath();
        worldCtx.moveTo(x - layerW / 2, layerY);
        worldCtx.lineTo(x + layerW / 2, layerY);
        worldCtx.lineTo(x, layerY - 60 * scale);
        worldCtx.fill();
    }
}

/**
 * Draws a wood drop in 3D
 */
function drawWoodDrop3D(screenX, scale) {
    const size = 15 * scale;
    const x = worldCanvas.width / 2 + screenX;
    const y = worldCanvas.height / 2 + 100 * scale;
    worldCtx.fillStyle = '#8b4513';
    worldCtx.fillRect(x - size / 2, y - size / 2, size, size);
}

/**
 * Draws a bear in 3D
 */
function drawBear3D(screenX, scale) {
    worldCtx.save();
    const x = worldCanvas.width / 2 + screenX;
    const y = worldCanvas.height / 2 + 80 * scale;
    worldCtx.translate(x, y);
    worldCtx.scale(scale, scale);

    worldCtx.fillStyle = '#5C4033'; // Dark brown
    worldCtx.beginPath(); worldCtx.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2); worldCtx.fill();
    worldCtx.beginPath(); worldCtx.arc(12, -5, 8, 0, Math.PI * 2); worldCtx.fill();
    worldCtx.beginPath(); worldCtx.arc(8, -12, 3, 0, Math.PI * 2); worldCtx.arc(16, -12, 3, 0, Math.PI * 2);
    worldCtx.fill();
    worldCtx.restore();
}

function harvestAtPlayerPos() { /* Deprecated in First POV */ }

/**
 * Core harvesting logic for the 3-second hold
 */
function breakTreeAtTarget(tx, ty) {
    const localPlayer = myRole === 'p1' ? p1 : p2;
    destroyedTrees.add(`${tx},${ty}`);
    woodDrops.push({ x: tx + CELL_SIZE / 2, y: ty + CELL_SIZE / 2, amount: 1 });
    log("System: Tree broken!");
    return true;
}

/**
 * Calculates and draws bear behavior in 3D space
 */
function processBear3D(cx, cy, localPlayer, camX, camY) {
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
        
        return { type: 'bear', x: bX, y: bY };
    }
    return null;
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
    if (movement.w) { localPlayer.x += Math.cos(playerAngle) * PLAYER_SPEED; localPlayer.y += Math.sin(playerAngle) * PLAYER_SPEED; moved = true; }
    if (movement.s) { localPlayer.x -= Math.cos(playerAngle) * PLAYER_SPEED; localPlayer.y -= Math.sin(playerAngle) * PLAYER_SPEED; moved = true; }
    if (movement.a) { playerAngle -= ROTATION_SPEED; moved = true; }
    if (movement.d) { playerAngle += ROTATION_SPEED; moved = true; }

    // Clamp player position (arbitrary bounds for visual stability, world is infinite conceptually)
    localPlayer.x = Math.max(-10000, Math.min(10000, localPlayer.x));
    localPlayer.y = Math.max(-10000, Math.min(10000, localPlayer.y));

    if (moved && isOnlineMode && conn) {
        conn.send({ type: 'POS', x: localPlayer.x, y: localPlayer.y });
    }

    // Clear canvas
    worldCtx.fillStyle = '#87CEEB'; // Sky
    worldCtx.fillRect(0, 0, worldCanvas.width, worldCanvas.height / 2);
    worldCtx.fillStyle = '#0a2f0a';
    worldCtx.fillRect(0, worldCanvas.height / 2, worldCanvas.width, worldCanvas.height / 2); // Grass

    // Find all objects in vicinity and project them
    let objects = [];
    const viewRadius = 600;
    const viewLeft = Math.floor((localPlayer.x - viewRadius) / CHUNK_SIZE);
    const viewRight = Math.ceil((localPlayer.x + viewRadius) / CHUNK_SIZE);
    const viewTop = Math.floor((localPlayer.y - viewRadius) / CHUNK_SIZE);
    const viewBottom = Math.ceil((localPlayer.y + viewRadius) / CHUNK_SIZE);

    let nearestTree = null;
    let minTreeDist = Infinity;

    // Gather trees and bears
    for (let cx = viewLeft; cx <= viewRight; cx++) {
        for (let cy = viewTop; cy <= viewBottom; cy++) {
            for (let x = 0; x < CHUNK_SIZE; x += CELL_SIZE) {
                for (let y = 0; y < CHUNK_SIZE; y += CELL_SIZE) {
                    const wx = cx * CHUNK_SIZE + x;
                    const wy = cy * CHUNK_SIZE + y;
                    if (worldHash(wx, wy) < TREE_DENSITY && !destroyedTrees.has(`${wx},${wy}`)) {
                        const p = project(wx, wy, localPlayer.x, localPlayer.y, playerAngle);
                        if (p.x > 5) {
                            objects.push({ type: 'tree', ...p, wx, wy });
                            if (p.x < minTreeDist && Math.abs(p.y) < 50) {
                                minTreeDist = p.x;
                                nearestTree = { wx, wy };
                            }
                        }
                    }
                }
            }
            const bear = processBear3D(cx, cy, localPlayer, 0, 0);
            if (bear) {
                const p = project(bear.x, bear.y, localPlayer.x, localPlayer.y, playerAngle);
                if (p.x > 5) objects.push({ type: 'bear', ...p });
            }
        }
    }

    // Gather wood drops
    woodDrops.forEach((drop, index) => {
        const p = project(drop.x, drop.y, localPlayer.x, localPlayer.y, playerAngle);
        if (p.x > 5) objects.push({ type: 'drop', ...p, index });
    });

    // Add Opponent
    if (isOnlineMode) {
        const p = project(opponentPlayer.x, opponentPlayer.y, localPlayer.x, localPlayer.y, playerAngle);
        if (p.x > 5) objects.push({ type: 'opponent', ...p });
    }

    // Sort by distance (Painter's algorithm)
    objects.sort((a, b) => b.x - a.x);

    // Draw objects
    objects.forEach(obj => {
        const scale = 200 / obj.x;
        if (obj.type === 'tree') drawTree3D(obj.y * scale, scale);
        else if (obj.type === 'bear') drawBear3D(obj.y * scale, scale);
        else if (obj.type === 'drop') drawWoodDrop3D(obj.y * scale, scale);
        else if (obj.type === 'opponent') {
            worldCtx.save();
            worldCtx.translate(worldCanvas.width/2 + obj.y * scale, worldCanvas.height/2 + 80 * scale);
            worldCtx.scale(scale * 2, scale * 2);
            drawHuman(0, 0, '#ff4444', false);
            worldCtx.restore();
        }
    });

    // Harvesting Logic
    if (movement.b && nearestTree && minTreeDist < 80) {
        if (!currentHarvestTarget || currentHarvestTarget.x !== nearestTree.wx || currentHarvestTarget.y !== nearestTree.wy) {
            currentHarvestTarget = { x: nearestTree.wx, y: nearestTree.wy };
            harvestTimer = 0;
        }
        harvestTimer++;
        
        // Progress Bar
        const progress = harvestTimer / HARVEST_TIME_REQUIRED;
        worldCtx.fillStyle = '#222';
        worldCtx.fillRect(worldCanvas.width / 2 - 50, worldCanvas.height / 2 - 100, 100, 10);
        worldCtx.fillStyle = '#00ffcc';
        worldCtx.fillRect(worldCanvas.width / 2 - 50, worldCanvas.height / 2 - 100, 100 * progress, 10);

        if (harvestTimer >= HARVEST_TIME_REQUIRED) {
            breakTreeAtTarget(nearestTree.wx, nearestTree.wy);
            harvestTimer = 0;
            currentHarvestTarget = null;
        }
    } else {
        harvestTimer = 0;
        currentHarvestTarget = null;
    }

    // Wood collection (Distance check in 2D space)
    woodDrops = woodDrops.filter(drop => {
        const d = Math.hypot(localPlayer.x - drop.x, localPlayer.y - drop.y);
        if (d < 30) {
            localPlayer.inventory.wood = Math.min(100, localPlayer.inventory.wood + 1);
            localPlayer.energy = Math.min(100, localPlayer.energy + 1);
            updateUI();
            return false;
        }
        return true;
    });

    requestAnimationFrame(worldLoop);
}

worldLoop();