/**
 * Bear AI and Rendering System
 */

const CHUNK_SIZE = 400; // Pixels per chunk
let bearOffsets = {}; // Persistent offsets for moving bears
let killedBears = new Set(); // Stores coordinates of killed bears

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

/**
 * Calculates and draws bear behavior in 3D space
 */
function processBear3D(cx, cy, localPlayer) {
    // Prevent bears from spawning in chunks containing the player spawn points (0,0 and 1,0)
    if (cy === 0 && (cx === 0 || cx === 1)) return null;

    // 1% chance per chunk to have a bear
    if (worldHash(cx + 500, cy + 500) < 0.01 && !killedBears.has(`${cx},${cy}`)) {
        const bBaseX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
        const bBaseY = cy * CHUNK_SIZE + CHUNK_SIZE / 2;
        
        if (!bearOffsets[`${cx},${cy}`]) {
            const spawnDist = Math.hypot(localPlayer.x - bBaseX, localPlayer.y - bBaseY);
            if (spawnDist < 450) return null;
            bearOffsets[`${cx},${cy}`] = {x: 0, y: 0, aggro: false};
        }
        const offset = bearOffsets[`${cx},${cy}`];
        const bX = bBaseX + offset.x;
        const bY = bBaseY + offset.y;
        
        const distToPlayer = Math.hypot(localPlayer.x - bX, localPlayer.y - bY);

        offset.aggro = true;
        let angle = Math.atan2(localPlayer.y - bY, localPlayer.x - bX);
        const speed = 9.5;

        let nextX = bX + Math.cos(angle) * speed;
        let nextY = bY + Math.sin(angle) * speed;

        // Safe zone and steering check
        if (Math.hypot(nextX - 100, nextY - 200) > 200 && Math.hypot(nextX - 500, nextY - 200) > 200) {
            if (!isCollidingWithTree(nextX, nextY)) {
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