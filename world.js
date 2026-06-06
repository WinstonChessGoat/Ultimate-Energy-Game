/**
 * Infinite Forest World Engine
 */
// Access global game state from game.js
/* global p1, p2, p1Score, currentUser, isInWorld, isOnlineMode, myRole, socket, log, updateUI, syncInventory */

// Canvas setup
const worldCanvas = document.getElementById('worldCanvas');
const worldCtx = worldCanvas.getContext('2d');

const CHUNK_SIZE = 400; // Pixels per chunk
const TREE_DENSITY = 0.06; // Sparse forest for more realistic spacing
const PLAYER_SPEED = 3; // Pixels per frame
const SPRINT_SPEED = 10.5; // Faster than bear's 9.5
const ROTATION_SPEED = 0.05; // Radians per frame
const CELL_SIZE = 25; // Size of a grid cell for tree placement
const HARVEST_TIME_REQUIRED = 180; // 3 seconds at 60fps
const HARVEST_TIME_AXE = 90; // 1.5 seconds at 60fps
const GRAVITY = 0.4;
const JUMP_FORCE = 8;
const MAX_PITCH = 50 * (Math.PI / 180); // 50 degrees in radians

let movement = { w: false, a: false, s: false, d: false, arrowup: false, arrowdown: false, arrowleft: false, arrowright: false };
let destroyedTrees = new Set(); // Stores coordinates of cut trees
let woodDrops = []; // Stores active wood drops
let bearOffsets = {}; // Persistent offsets for moving bears
let killedBears = new Set(); // Stores coordinates of killed bears
let protectiveCircleTimer = 0; // Remaining frames for the shield
let lastTapTime = 0; // Track timing for mobile double-taps
let lastWPressTime = 0; // Track timing for 'w' double-taps
let isSprinting = false; // Whether the player is sprinting
let smoothCamHeight = 80; // Interpolated camera height
let smoothHorizonShift = 0; // Interpolated horizon shift
let currentVel = 0; // Current movement velocity for momentum
let currentRotVel = 0; // Current rotational velocity for smooth turns
let harvestTimer = 0; // Current progress on cutting a tree
let currentHarvestTarget = null; // Coordinates of tree being cut
let playerAngle = 0; // Player's horizontal orientation
let playerZ = 0; // Player height (for jumping)
let zVelocity = 0; // Vertical speed
let verticalAngle = 0; // Pitch (looking up/down)
let currentPOV = 1; // 1: First Person, 2: Second Person, 3: Third Person
let worldAudioCtx = null;

/**
 * Synthesizes a satisfying "plop" sound for wood collection
 */
function playPlopSound() {
    if (!worldAudioCtx) worldAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (worldAudioCtx.state === 'suspended') worldAudioCtx.resume();

    const osc = worldAudioCtx.createOscillator();
    const gain = worldAudioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, worldAudioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, worldAudioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.5, worldAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, worldAudioCtx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(worldAudioCtx.destination);

    osc.start();
    osc.stop(worldAudioCtx.currentTime + 0.1);
}

// Procedural hash function for deterministic tree placement across chunks
function worldHash(x, y) {
    // Using a larger prime and a different seed for better distribution
    const h = Math.sin(x * 12345.6789 + y * 98765.4321 + 54321) * 43758.5453123;
    return h - Math.floor(h);
}

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (isInWorld) { // Only process these keys if in world mode
        if (key === 'w' && !movement[key]) {
            const now = Date.now();
            if (now - lastWPressTime < 300) {
                isSprinting = true;
            }
            lastWPressTime = now;
        }

        if (key === '1') currentPOV = 1;
        if (key === '2') currentPOV = 2;
        if (key === '3') currentPOV = 3;

        movement[key] = true;
        if (key === ' ') {
            handleJump();
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
        if (key === 'w') {
            isSprinting = false;
        }
    }
});

/**
 * Handles jump logic for both Desktop (Space) and Mobile (Button)
 */
function handleJump() {
    if (playerZ === 0) {
        zVelocity = JUMP_FORCE;
    }
}

/**
 * Floating Joystick Controller Logic
 */
const joystickContainer = document.getElementById('joystick-container');
const joystickHandle = document.getElementById('joystick-handle');
const worldScreen = document.getElementById('world-screen');
let joystickActive = false;
let joystickOrigin = { x: 0, y: 0 };
let lookTouchActive = false;
let lastTouchY = 0;

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
        } else {
            // Right side of screen handles looking up/down
            lookTouchActive = true;
            lastTouchY = touch.clientY;
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        e.preventDefault(); // Stop page scrolling while moving
        const touch = e.touches[0];
        
        if (joystickActive && touch.clientX < window.innerWidth / 2) {
            updateJoystick(touch.clientX, touch.clientY);
        } else if (lookTouchActive) {
            const dy = touch.clientY - lastTouchY;
            verticalAngle -= dy * 0.005; // Sensitivity
            verticalAngle = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, verticalAngle));
            lastTouchY = touch.clientY;
        }
    }, { passive: false });

    window.addEventListener('touchend', () => {
        if (!joystickActive) return;
        joystickActive = false;
        joystickContainer.style.display = 'none';
        joystickHandle.style.transform = `translate(-50%, -50%)`;
        movement.w = movement.a = movement.s = movement.d = false;
        lookTouchActive = false;
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
    // Shield activation moved to the backpack button for immediate effect.
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
function project(worldX, worldY, camX, camY, camAngle) {
    const dx = worldX - camX;
    const dy = worldY - camY;
    const rotX = dx * Math.cos(-camAngle) - dy * Math.sin(-camAngle);
    const rotY = dx * Math.sin(-camAngle) + dy * Math.cos(-camAngle);
    return { x: rotX, y: rotY, dist: rotX }; // x is depth, y is horizontal
}

/**
 * Toggles the visibility of the inventory UI and updates the counts.
 */
function toggleInventoryUI() {
    const invBox = document.getElementById('inventory-overlay-box');
    if (!invBox) return;

    const isHidden = invBox.classList.contains('hidden');
    if (isHidden) {
        invBox.classList.remove('hidden');
        if (typeof syncInventory === 'function') syncInventory();
    } else {
        invBox.classList.add('hidden');
    }
}

/**
 * Draws a human character with simple animation
 */
function drawHuman(x, y, color, isMoving, isFacingAway = false, isAlive = true) {
    worldCtx.save();
    const lookShift = Math.tan(verticalAngle) * 3; // Subtle head tilt based on gaze
    
    // Anchor at ground base for realistic perspective
    worldCtx.translate(x, y); 

    if (!isAlive) {
        worldCtx.rotate(Math.PI / 2); // Fall over if dead
        worldCtx.translate(0, -5);
    }

    // Ground Shadow for realism
    worldCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    worldCtx.beginPath();
    worldCtx.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2);
    worldCtx.fill();

    const bob = isMoving ? Math.sin(Date.now() / 150) * 2 : 0;
    const swing = isMoving ? Math.sin(Date.now() / 150) * 0.4 : 0; // Rotational swing in radians

    // 1. Draw Legs (Pivot from hips to prevent "breaking apart")
    worldCtx.fillStyle = '#1a1a1a';
    const hipY = -12;
    
    // Left Leg
    worldCtx.save();
    worldCtx.translate(-3, hipY);
    worldCtx.rotate(swing);
    worldCtx.fillRect(-2, 0, 4, 12);
    worldCtx.restore();

    // Right Leg
    worldCtx.save();
    worldCtx.translate(3, hipY);
    worldCtx.rotate(-swing);
    worldCtx.fillRect(-2, 0, 4, 12);
    worldCtx.restore();

    // 2. Upper Body (Head, Torso, Arms move as one unit for bobbing)
    worldCtx.translate(0, bob);

    // Torso (Main body block)
    worldCtx.fillStyle = color;
    worldCtx.fillRect(-7, -28, 14, 16);

    // Head (Connected directly to torso)
    const headY = -35 + lookShift;
    worldCtx.fillStyle = isFacingAway ? '#4b3621' : '#ffdbac';
    worldCtx.beginPath();
    worldCtx.arc(0, headY, 7, 0, Math.PI * 2);
    worldCtx.fill();

    if (isFacingAway) {
        worldCtx.fillStyle = '#3d2b1f'; // Darker hair shade
        worldCtx.beginPath();
        worldCtx.arc(0, headY + 2, 5, 0, Math.PI);
        worldCtx.fill();
    } else {
        worldCtx.fillStyle = '#333';
        const eyeHeight = headY - 1;
        worldCtx.beginPath();
        worldCtx.arc(-2.5, eyeHeight, 1.2, 0, Math.PI * 2);
        worldCtx.arc(2.5, eyeHeight, 1.2, 0, Math.PI * 2);
        worldCtx.fill();
    }

    // 3. Arms (Pivot from shoulders)
    worldCtx.fillStyle = color;
    const shoulderY = -26;
    
    worldCtx.save();
    worldCtx.translate(-7, shoulderY);
    worldCtx.rotate(-swing * 0.8); // Opposite swing to legs for balance
    worldCtx.fillRect(-4, 0, 4, 12);
    worldCtx.restore();

    worldCtx.save();
    worldCtx.translate(7, shoulderY);
    worldCtx.rotate(swing * 0.8);
    worldCtx.fillRect(0, 0, 4, 12);
    worldCtx.restore();

    worldCtx.restore();
}

/**
 * Renders a tree with 3D perspective
 */
function drawTree3D(screenX, scale, horizonY, camHeight = 80) {
    const trunkW = 30 * scale;
    const trunkH = 180 * scale; // Significantly taller
    const leafW = 120 * scale;

    const x = worldCanvas.width / 2 + screenX;
    const groundY = horizonY + (camHeight + playerZ) * scale; 

    // Trunk
    worldCtx.fillStyle = '#5C4033';
    worldCtx.fillRect(x - trunkW / 2, groundY - trunkH, trunkW, trunkH);

    // Foliage (Cone layers)
    worldCtx.fillStyle = '#2d5a27';
    const foliageTop = groundY - trunkH;
    for (let i = 0; i < 4; i++) {
        const layerY = foliageTop - (i * 40 * scale);
        const layerW = leafW * (1.2 - i * 0.25);
        worldCtx.beginPath();
        worldCtx.moveTo(x - layerW / 2, layerY);
        worldCtx.lineTo(x + layerW / 2, layerY);
        worldCtx.lineTo(x, layerY - 80 * scale);
        worldCtx.fill();
    }
}

/**
 * Draws a wood drop in 3D
 */
function drawWoodDrop3D(screenX, scale, horizonY, camHeight = 80) {
    const size = 15 * scale;
    const x = worldCanvas.width / 2 + screenX;
    const y = horizonY + (camHeight + 20 + playerZ) * scale;
    worldCtx.fillStyle = '#8b4513';
    worldCtx.fillRect(x - size / 2, y - size / 2, size, size);
}

/**
 * Draws a bear in 3D
 */
function drawBear3D(screenX, scale, horizonY, camHeight = 80, isAggro = false, lookRotation = 0) {
    worldCtx.save();
    const bearScale = scale * 1.3; // Scaled to match the human character's visual height
    const x = worldCanvas.width / 2 + screenX;
    const groundY = horizonY + (camHeight + playerZ) * scale;

    const faceShift = Math.sin(lookRotation) * 12;
    const isFacingAway = Math.abs(lookRotation) > Math.PI / 2;

    worldCtx.translate(x, groundY);
    worldCtx.scale(bearScale, bearScale);

    const walkCycle = Math.sin(Date.now() / 150);
    const furColor = '#3d2b1f';
    const shadowColor = '#2a1d15';

    // Front-Facing Body
    worldCtx.fillStyle = furColor;
    worldCtx.beginPath(); worldCtx.ellipse(0, -20, 22, 28, 0, 0, Math.PI * 2); worldCtx.fill();
    
    // Front Legs
    const legY = -5 + (isAggro ? walkCycle * 5 : 0);
    worldCtx.fillRect(-18, legY, 10, 20);
    worldCtx.fillRect(8, legY, 10, 20);
    // Claws
    worldCtx.fillStyle = '#111';
    for(let i=0; i<3; i++) {
        worldCtx.fillRect(-17 + i*3, legY + 18, 2, 4);
        worldCtx.fillRect(9 + i*3, legY + 18, 2, 4);
    }

    // Head
    worldCtx.fillStyle = furColor;
    worldCtx.beginPath(); worldCtx.arc(faceShift * 0.2, -45, 18, 0, Math.PI * 2); worldCtx.fill();
    
    // Ears
    worldCtx.fillStyle = furColor;
    const earShift = faceShift * 0.5;
    worldCtx.beginPath(); 
    worldCtx.arc(-12 + earShift, -58, 6, 0, Math.PI * 2); 
    worldCtx.arc(12 + earShift, -58, 6, 0, Math.PI * 2); 
    worldCtx.fill();

    if (!isFacingAway) {
        // Snout
        worldCtx.fillStyle = shadowColor;
        worldCtx.beginPath(); worldCtx.ellipse(faceShift, -42, 10, 8, 0, 0, Math.PI * 2); worldCtx.fill();
        worldCtx.fillStyle = 'black';
        worldCtx.beginPath(); worldCtx.arc(faceShift, -42, 3, 0, Math.PI * 2); worldCtx.fill();

        // Eyes (Turn red when aggro)
        worldCtx.fillStyle = isAggro ? '#ff0000' : 'white';
        worldCtx.beginPath(); worldCtx.arc(-7 + faceShift, -48, 3, 0, Math.PI * 2); worldCtx.arc(7 + faceShift, -48, 3, 0, Math.PI * 2); worldCtx.fill();
        worldCtx.fillStyle = 'black';
        worldCtx.beginPath(); worldCtx.arc(-6.5 + faceShift, -48, 1.5, 0, Math.PI * 2); worldCtx.arc(7.5 + faceShift, -48, 1.5, 0, Math.PI * 2); worldCtx.fill();
    }

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

    // Axe durability logic
    if (localPlayer.inventory.axe > 0) {
        if (localPlayer.axeUsesLeft <= 0) {
            localPlayer.axeUsesLeft = 50; // Initialize durability for the current axe
        }
        localPlayer.axeUsesLeft--;
        if (localPlayer.axeUsesLeft <= 0) {
            localPlayer.inventory.axe--;
            log("System: Your axe has broken!");
            if (typeof syncInventory === 'function') syncInventory();
        }
    }
    return true;
}

/**
 * Efficiently checks if a world coordinate collides with any tree trunk
 */
function isCollidingWithTree(nx, ny) {
    const trunkRadius = 22;
    const checkRange = 30; // Small radius for performance
    
    const startX = Math.floor((nx - checkRange) / CELL_SIZE) * CELL_SIZE;
    const endX = Math.ceil((nx + checkRange) / CELL_SIZE) * CELL_SIZE;
    const startY = Math.floor((ny - checkRange) / CELL_SIZE) * CELL_SIZE;
    const endY = Math.ceil((ny + checkRange) / CELL_SIZE) * CELL_SIZE;

    for (let wx = startX; wx <= endX; wx += CELL_SIZE) {
        for (let wy = startY; wy <= endY; wy += CELL_SIZE) {
            if (worldHash(wx, wy) < TREE_DENSITY && !destroyedTrees.has(`${wx},${wy}`)) {
                if (Math.hypot(nx - wx, ny - wy) < trunkRadius) return true;
            }
        }
    }
    return false;
}

/**
 * Calculates and draws bear behavior in 3D space
 */
function processBear3D(cx, cy, localPlayer, camX, camY) {
    // Prevent bears from spawning in chunks containing the player spawn points (0,0 and 1,0)
    if (cy === 0 && (cx === 0 || cx === 1)) return null;

    // 1% chance per chunk to have a bear (Extremely rare frequency)
    if (worldHash(cx + 500, cy + 500) < 0.01 && !killedBears.has(`${cx},${cy}`)) {
        const bBaseX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
        const bBaseY = cy * CHUNK_SIZE + CHUNK_SIZE / 2;
        
        if (!bearOffsets[`${cx},${cy}`]) {
            // Prevent bears from spawning too close to the human player
            const spawnDist = Math.hypot(localPlayer.x - bBaseX, localPlayer.y - bBaseY);
            if (spawnDist < 450) return null;
            bearOffsets[`${cx},${cy}`] = {x: 0, y: 0, aggro: false};
        }
        const offset = bearOffsets[`${cx},${cy}`];
        const bX = bBaseX + offset.x;
        const bY = bBaseY + offset.y;
        
        const distToPlayer = Math.hypot(localPlayer.x - bX, localPlayer.y - bY);

        // The bear is now always aggressive and ignores detection distance
        offset.aggro = true;
        let angle = Math.atan2(localPlayer.y - bY, localPlayer.x - bX);
        const speed = 9.5; // Aggressive run speed

        let nextX = bX + Math.cos(angle) * speed;
        let nextY = bY + Math.sin(angle) * speed;

        // Safe zone check (keep bears away from spawn points)
        if (Math.hypot(nextX - 100, nextY - 200) > 200 && Math.hypot(nextX - 500, nextY - 200) > 200) {
            // Smarter Pathfinding: Steering behavior to avoid trees
            if (isCollidingWithTree(nextX, nextY)) {
                let steered = false;
                for (let i = 1; i <= 6; i++) {
                    const steerOffset = i * 15 * (Math.PI / 180);
                    if (!isCollidingWithTree(bX + Math.cos(angle - steerOffset) * speed, bY + Math.sin(angle - steerOffset) * speed)) {
                        angle -= steerOffset; steered = true; break;
                    }
                    if (!isCollidingWithTree(bX + Math.cos(angle + steerOffset) * speed, bY + Math.sin(angle + steerOffset) * speed)) {
                        angle += steerOffset; steered = true; break;
                    }
                }
                if (steered) {
                    offset.x += Math.cos(angle) * speed;
                    offset.y += Math.sin(angle) * speed;
                }
            } else {
                offset.x += Math.cos(angle) * speed;
                offset.y += Math.sin(angle) * speed;
            }
        }
        
        // Collision detection
        if (protectiveCircleTimer > 0 && distToPlayer < 15 + 15) {
            killedBears.add(`${cx},${cy}`);
            log("System: Bear killed by protective circle!");
        } else if (distToPlayer < 20 + 15) {
            log("System: A bear caught you! Teleporting and losing wood...");
            localPlayer.x = myRole === 'p1' ? 100 : 500;
            localPlayer.y = 200;
            localPlayer.inventory.wood = 0;
            localPlayer.energy = 0;
            updateUI();
            if (isOnlineMode && socket) {
                socket.send(JSON.stringify({ type: 'POS', x: localPlayer.x, y: localPlayer.y }));
                socket.send(JSON.stringify({ type: 'INVENTORY_UPDATE', inventoryWood: 0 }));
                socket.send(JSON.stringify({ type: 'ENERGY_UPDATE', energy: 0 }));
            }
        }
        
        return { type: 'bear', x: bX, y: bY, aggro: offset.aggro };
    }
    return null;
}

function worldLoop() {
    if (!isInWorld) {
        requestAnimationFrame(worldLoop);
        return;
    }

    if (protectiveCircleTimer > 0) protectiveCircleTimer--;

    // Default to P1 for local play, otherwise use the assigned role
    const localPlayer = (isOnlineMode && myRole === 'p2') ? p2 : p1;
    const opponentPlayer = (isOnlineMode && myRole === 'p2') ? p1 : p2;

    // Determine Camera Position and Angle based on POV
    let camX = localPlayer.x;
    let camY = localPlayer.y;
    let camAngle = playerAngle; 
    const tiltFactor = verticalAngle / MAX_PITCH; // -1 (down) to 1 (up)

    // Target parameters for camera smoothing
    let targetCamHeight = 80;
    let targetHorizonShift = Math.tan(verticalAngle) * 180;

    if (currentPOV === 2) {
        // Second Person: Front-facing cinematic view looking at the player
        const dynamicDist = 150 + tiltFactor * 60;
        camX = localPlayer.x + Math.cos(playerAngle) * dynamicDist;
        camY = localPlayer.y + Math.sin(playerAngle) * dynamicDist;
        camAngle = playerAngle + Math.PI;
        targetCamHeight = 80 - Math.tan(verticalAngle) * 200;
    } else if (currentPOV === 3) {
        // Third Person: Follow camera behind the player
        const dynamicDist = 100 + tiltFactor * 40;
        camX = localPlayer.x - Math.cos(playerAngle) * dynamicDist;
        camY = localPlayer.y - Math.sin(playerAngle) * dynamicDist;
        camAngle = playerAngle;
        targetCamHeight = 80 - Math.tan(verticalAngle) * 450;
        targetHorizonShift = Math.tan(verticalAngle) * 320;
    }

    // Smooth camera damping
    smoothCamHeight += (Math.max(20, targetCamHeight) - smoothCamHeight) * 0.12;
    smoothHorizonShift += (targetHorizonShift - smoothHorizonShift) * 0.12;
    const camHeight = smoothCamHeight;
    const horizonY = (worldCanvas.height / 2) + smoothHorizonShift;

    let nextX = localPlayer.x;
    let nextY = localPlayer.y;
    let moved = false;

    // Movement Momentum: Gradually accelerate and decelerate for a more natural feel
    const targetVel = (movement.w || movement.s || movement.a || movement.d) ? (isSprinting ? SPRINT_SPEED : PLAYER_SPEED) : 0;
    currentVel += (targetVel - currentVel) * 0.15;

    if (currentVel > 0.05) {
        if (movement.w) { nextX += Math.cos(playerAngle) * currentVel; nextY += Math.sin(playerAngle) * currentVel; }
        if (movement.s) { nextX -= Math.cos(playerAngle) * currentVel; nextY -= Math.sin(playerAngle) * currentVel; }
        if (movement.a) { nextX += Math.sin(playerAngle) * currentVel; nextY -= Math.cos(playerAngle) * currentVel; }
        if (movement.d) { nextX -= Math.sin(playerAngle) * currentVel; nextY += Math.cos(playerAngle) * currentVel; }
        moved = true;
    }
    
    if (moved) {
        // Tree collision: Stop player if walking into a trunk
        if (!isCollidingWithTree(nextX, nextY)) {
            localPlayer.x = nextX;
            localPlayer.y = nextY;
        }
    }

    // Looking logic: Inverted for 2nd POV to feel natural since camera is facing the player
    if (currentPOV === 2) {
        if (movement.arrowup) verticalAngle = Math.max(-MAX_PITCH, verticalAngle - 0.03);
        if (movement.arrowdown) verticalAngle = Math.min(MAX_PITCH, verticalAngle + 0.03);
    } else {
        if (movement.arrowup) verticalAngle = Math.min(MAX_PITCH, verticalAngle + 0.03);
        if (movement.arrowdown) verticalAngle = Math.max(-MAX_PITCH, verticalAngle - 0.03);
    }

    // Rotation inertia
    const targetRotVel = movement.arrowleft ? -ROTATION_SPEED : (movement.arrowright ? ROTATION_SPEED : 0);
    currentRotVel += (targetRotVel - currentRotVel) * 0.15;
    if (Math.abs(currentRotVel) > 0.001) {
        playerAngle += currentRotVel;
        moved = true;
    }

    // Clamp player position (arbitrary bounds for visual stability, world is infinite conceptually)
    localPlayer.x = Math.max(-10000, Math.min(10000, localPlayer.x));
    localPlayer.y = Math.max(-10000, Math.min(10000, localPlayer.y));

    // Jump Physics
    if (playerZ > 0 || zVelocity !== 0) {
        playerZ += zVelocity;
        zVelocity -= GRAVITY;
        if (playerZ <= 0) {
            playerZ = 0;
            zVelocity = 0;
        }
        moved = true; // Force sync in online mode if jumping
    }

    if (moved && isOnlineMode && socket) {
        socket.send(JSON.stringify({ type: 'POS', x: localPlayer.x, y: localPlayer.y }));
    }

    worldCtx.fillStyle = '#87CEEB'; // Sky
    worldCtx.fillRect(0, 0, worldCanvas.width, horizonY);
    worldCtx.fillStyle = '#0a2f0a';
    worldCtx.fillRect(0, horizonY, worldCanvas.width, worldCanvas.height - horizonY); // Grass

    // Find all objects in vicinity and project them
    let objects = [];
    const viewRadius = 2000; // Increased to allow seeing bears from a long distance
    const treeViewRadius = 800; // Keep tree rendering range limited for performance
    const viewLeft = Math.floor((localPlayer.x - viewRadius) / CHUNK_SIZE);
    const viewRight = Math.ceil((localPlayer.x + viewRadius) / CHUNK_SIZE);
    const viewTop = Math.floor((localPlayer.y - viewRadius) / CHUNK_SIZE);
    const viewBottom = Math.ceil((localPlayer.y + viewRadius) / CHUNK_SIZE);

    // Bounds for tree processing to maintain high FPS
    const tLeft = Math.floor((localPlayer.x - treeViewRadius) / CHUNK_SIZE);
    const tRight = Math.ceil((localPlayer.x + treeViewRadius) / CHUNK_SIZE);
    const tTop = Math.floor((localPlayer.y - treeViewRadius) / CHUNK_SIZE);
    const tBottom = Math.ceil((localPlayer.y + treeViewRadius) / CHUNK_SIZE);

    let nearestTree = null;
    let minTreeDist = Infinity;

    // Gather trees and bears
    for (let cx = viewLeft; cx <= viewRight; cx++) {
        for (let cy = viewTop; cy <= viewBottom; cy++) {
            // Only process tree cells if the chunk is within the treeViewRadius
            if (cx >= tLeft && cx <= tRight && cy >= tTop && cy <= tBottom) {
                for (let x = 0; x < CHUNK_SIZE; x += CELL_SIZE) {
                    for (let y = 0; y < CHUNK_SIZE; y += CELL_SIZE) {
                        const wx = cx * CHUNK_SIZE + x;
                        const wy = cy * CHUNK_SIZE + y;
                        if (worldHash(wx, wy) < TREE_DENSITY && !destroyedTrees.has(`${wx},${wy}`)) {
                            // Visual projection
                            const pVis = project(wx, wy, camX, camY, camAngle);
                            if (pVis.x > 5) objects.push({ type: 'tree', ...pVis, wx, wy });

                            // Interaction logic (Harvesting)
                            const pInt = project(wx, wy, localPlayer.x, localPlayer.y, playerAngle);
                            if (pInt.x > 5 && pInt.x < minTreeDist && Math.abs(pInt.y) < 15) {
                                minTreeDist = pInt.x;
                                nearestTree = { wx, wy };
                            }
                        }
                    }
                }
            }
            const bear = processBear3D(cx, cy, localPlayer, 0, 0);
            if (bear) {
                const p = project(bear.x, bear.y, camX, camY, camAngle);
                if (p.x > 5) {
                    // Calculate the angle from bear to player vs bear to camera
                    const angleToPlayer = Math.atan2(localPlayer.y - bear.y, localPlayer.x - bear.x);
                    const angleToCam = Math.atan2(camY - bear.y, camX - bear.x);
                    let lookRotation = angleToPlayer - angleToCam;
                    // Normalize to [-PI, PI]
                    lookRotation = ((lookRotation + Math.PI) % (Math.PI * 2)) - Math.PI;
                    
                    objects.push({ type: 'bear', ...p, aggro: bear.aggro, lookRotation });
                }
            }
        }
    }

    // Gather wood drops
    woodDrops.forEach((drop, index) => {
        const p = project(drop.x, drop.y, camX, camY, camAngle);
        if (p.x > 5) objects.push({ type: 'drop', ...p, index });
    });

    // Add Opponent
    if (isOnlineMode) {
        const p = project(opponentPlayer.x, opponentPlayer.y, camX, camY, camAngle);
        if (p.x > 5) objects.push({ type: 'opponent', ...p });
    }

    // Add Local Player if in 2nd or 3rd person
    if (currentPOV !== 1) {
        const p = project(localPlayer.x, localPlayer.y, camX, camY, camAngle);
        if (p.x > 1) objects.push({ type: 'local_player', ...p, isMoving: moved, alive: localPlayer.alive, z: playerZ });
    }

    // Add Protective Circle segments (Circling wooden logs)
    if (protectiveCircleTimer > 0) {
        const numSegments = 64; // Increased density to form a solid "thin line" ring
        const shieldRadius = 15; // Shrunk to about 6 inches (game units) around the player
        const rotationOffset = Date.now() / 300;
        for (let i = 0; i < numSegments; i++) {
            const angle = (i / numSegments) * Math.PI * 2 + rotationOffset;
            const sx = localPlayer.x + Math.cos(angle) * shieldRadius;
            const sy = localPlayer.y + Math.sin(angle) * shieldRadius;
            const p = project(sx, sy, camX, camY, camAngle);
            if (p.x > 2) objects.push({ type: 'shield_segment', ...p });
        }
    }

    // Sort by distance (Painter's algorithm)
    objects.sort((a, b) => b.x - a.x);

    // Draw objects
    objects.forEach(obj => {
        const scale = 200 / obj.x;
        if (obj.type === 'tree') drawTree3D(obj.y * scale, scale, horizonY, camHeight);
        else if (obj.type === 'bear') drawBear3D(obj.y * scale, scale, horizonY, camHeight, obj.aggro, obj.lookRotation);
        else if (obj.type === 'drop') drawWoodDrop3D(obj.y * scale, scale, horizonY, camHeight);
        else if (obj.type === 'shield_segment') {
            const x = worldCanvas.width / 2 + obj.y * scale;
            const y = horizonY + (camHeight - 75 + playerZ) * scale; // Adjust shield relative to eye level
            
            // Realistic wood texture gradient for a "higher level" look
            const woodGrad = worldCtx.createLinearGradient(x - 10 * scale, 0, x + 10 * scale, 0);
            woodGrad.addColorStop(0, '#3e2723');
            woodGrad.addColorStop(0.4, '#8b4513');
            woodGrad.addColorStop(0.5, '#d2b48c'); // Highlight for much better visibility
            woodGrad.addColorStop(0.6, '#8b4513');
            woodGrad.addColorStop(1, '#3e2723');
            
            worldCtx.fillStyle = woodGrad;
            worldCtx.fillRect(x - 0.5 * scale, y - 5 * scale, 1 * scale, 10 * scale); // Thinner segments to suit the tight 6-inch radius
            
            // Add a subtle border to make the ring segments stand out
            worldCtx.strokeStyle = 'rgba(0,0,0,0.5)';
            worldCtx.lineWidth = 0.5 * scale;
            worldCtx.strokeRect(x - 0.5 * scale, y - 5 * scale, 1 * scale, 10 * scale);
        }
        else if (obj.type === 'local_player') {
            worldCtx.save();
            const humanFixedDrawScale = 2.5; // Fixed scale for human drawing to prevent enlargement
            
            let x = worldCanvas.width / 2 + obj.y * scale;
            let y = horizonY + (camHeight + playerZ - obj.z) * scale;

            worldCtx.translate(x, y);
            // Use a fixed scale for drawing the human to prevent enlargement
            worldCtx.scale(humanFixedDrawScale, humanFixedDrawScale); 
            drawHuman(0, 0, '#4444ff', obj.isMoving, currentPOV === 3, obj.alive); 
            worldCtx.restore();
        }
        else if (obj.type === 'opponent') {
            worldCtx.save();
            worldCtx.translate(worldCanvas.width/2 + obj.y * scale, horizonY + (camHeight + playerZ) * scale);
            const opponentFixedDrawScale = 2.0; // Fixed scale for opponent drawing
            worldCtx.scale(opponentFixedDrawScale, opponentFixedDrawScale);
            drawHuman(0, 0, '#ff4444', false);
            worldCtx.restore();
        }
    });

    // Harvesting Logic
    if (movement.b && nearestTree && minTreeDist < 160) { // Reach multiplied by 2 (80 -> 160)
        const requiredTime = (localPlayer.inventory.axe > 0) ? HARVEST_TIME_AXE : HARVEST_TIME_REQUIRED;
        if (!currentHarvestTarget || currentHarvestTarget.x !== nearestTree.wx || currentHarvestTarget.y !== nearestTree.wy) {
            currentHarvestTarget = { x: nearestTree.wx, y: nearestTree.wy };
            harvestTimer = 0;
        }
        harvestTimer++;
        
        // Progress Bar
        const progress = harvestTimer / requiredTime;
        worldCtx.fillStyle = '#222';
        worldCtx.fillRect(worldCanvas.width / 2 - 50, worldCanvas.height / 2 - 100, 100, 10);
        worldCtx.fillStyle = '#00ffcc';
        worldCtx.fillRect(worldCanvas.width / 2 - 50, worldCanvas.height / 2 - 100, 100 * progress, 10);

        if (harvestTimer >= requiredTime) {
            breakTreeAtTarget(nearestTree.wx, nearestTree.wy);
            harvestTimer = 0;
            currentHarvestTarget = null;
        }
    } else {
        harvestTimer = 0;
        currentHarvestTarget = null;
    }

    // Wood collection (Distance check in 2D space)
    woodDrops = woodDrops.filter((drop) => {
        const d = Math.hypot(localPlayer.x - drop.x, localPlayer.y - drop.y);
        if (d < 60) {
            localPlayer.inventory.wood = Math.min(100, localPlayer.inventory.wood + 1);
            localPlayer.energy = Math.min(100, localPlayer.energy + 1);
            playPlopSound();
            updateUI();
            return false;
        }
        return true;
    });

    // Draw a tiny crosshair in the middle of the screen
    const midX = worldCanvas.width / 2;
    const midY = worldCanvas.height / 2;
    worldCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    worldCtx.lineWidth = 1;
    worldCtx.beginPath();
    worldCtx.moveTo(midX - 5, midY); worldCtx.lineTo(midX + 5, midY);
    worldCtx.moveTo(midX, midY - 5); worldCtx.lineTo(midX, midY + 5);
    worldCtx.stroke();

    requestAnimationFrame(worldLoop);
}

worldLoop();