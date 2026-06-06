/**
 * Tree and Harvesting System
 */

const TREE_DENSITY = 0.06;
const HARVEST_TIME_REQUIRED = 180;
const HARVEST_TIME_AXE = 90;
const CELL_SIZE = 25;

let destroyedTrees = new Set(); // Stores coordinates of cut trees
let harvestTimer = 0; // Current progress on cutting a tree
let currentHarvestTarget = null; // Coordinates of tree being cut

// Procedural hash function for deterministic tree placement
function worldHash(x, y) {
    const h = Math.sin(x * 12345.6789 + y * 98765.4321 + 54321) * 43758.5453123;
    return h - Math.floor(h);
}

/**
 * Renders a tree with 3D perspective
 */
function drawTree3D(screenX, scale, horizonY, camHeight = 80) {
    const trunkW = 30 * scale;
    const trunkH = 180 * scale; 
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
 * Core harvesting logic for the 3-second hold
 */
function breakTreeAtTarget(tx, ty) {
    const localPlayer = myRole === 'p1' ? p1 : p2;
    destroyedTrees.add(`${tx},${ty}`);
    woodDrops.push({ x: tx + CELL_SIZE / 2, y: ty + CELL_SIZE / 2, amount: 1 });
    log("System: Tree broken!");

    if (typeof processAxeUsage === 'function') processAxeUsage(localPlayer);
    return true;
}

/**
 * Efficiently checks if a world coordinate collides with any tree trunk
 */
function isCollidingWithTree(nx, ny) {
    const trunkRadius = 22;
    const checkRange = 30; 
    
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
 * Manages the harvesting interaction and UI progress bar
 */
function handleTreeHarvesting(nearestTree, minTreeDist, localPlayer) {
    if (movement.b && nearestTree && minTreeDist < 160) {
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
}