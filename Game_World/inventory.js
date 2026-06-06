/**
 * Inventory and Trading System
 */

/**
 * Toggles the visibility of the inventory UI and updates the counts.
 */
function toggleInventoryUI() {
    const invBox = document.getElementById('inventory-overlay-box');
    if (!invBox) return;

    const isHidden = invBox.classList.contains('hidden');
    if (isHidden) {
        invBox.classList.remove('hidden');
        syncInventory();
    } else {
        invBox.classList.add('hidden');
    }
}

/**
 * Manages axe durability and inventory decrementing
 */
function processAxeUsage(player) {
    if (player.inventory.axe > 0) {
        if (player.axeUsesLeft <= 0) {
            player.axeUsesLeft = 50; // Initialize durability for the current axe
        }
        player.axeUsesLeft--;
        if (player.axeUsesLeft <= 0) {
            player.inventory.axe--;
            log("System: Your axe has broken!");
            syncInventory();
        }
    }
}

/**
 * Handles wood collection and energy gain
 */
function addWoodToInventory(player) {
    player.inventory.wood = Math.min(100, player.inventory.wood + 1);
    player.energy = Math.min(100, player.energy + 1);
    if (typeof playPlopSound === 'function') playPlopSound();
    updateUI();
}

/**
 * Trading System Logic
 */
function tradeWoodForScore() {
    const p = myRole === 'p1' ? p1 : p2;
    if (p.inventory.wood >= 20) {
        p.inventory.wood -= 20;
        p1Score += 5;
        if (typeof currentUser !== 'undefined') saveScoreToServer(currentUser, p1Score);
        log("System: Traded 20 Wood for 5 Score Points!");
        syncInventory();
    }
}

function tradeWoodForAxe() {
    const p = myRole === 'p1' ? p1 : p2;
    if (p.inventory.wood >= 5) {
        p.inventory.wood -= 5;
        p.inventory.axe += 1;
        log("System: Traded 5 Wood for a sturdy Axe!");
        syncInventory();
    }
}

function tradeWoodForDefense() {
    const p = myRole === 'p1' ? p1 : p2;
    if (p.inventory.wood >= 1) {
        if (typeof protectiveCircleTimer !== 'undefined' && protectiveCircleTimer > 0) {
            log("System: Shield is already active!");
            return;
        }
        p.inventory.wood -= 1;
        protectiveCircleTimer = 420; // Activate immediately (7 seconds)
        log("System: Wooden Shield activated!");
        syncInventory();
    }
}

function syncInventory() {
    const p = myRole === 'p1' ? p1 : p2;
    updateUI();
    if (isOnlineMode && socket) {
        socket.send(JSON.stringify({ 
            type: 'INVENTORY_UPDATE',
            inventoryWood: p.inventory.wood,
            inventoryAxe: p.inventory.axe
        }));
    }
    // Refresh visual counts if inventory is open
    const invBox = document.getElementById('inventory-overlay-box');
    if (invBox && !invBox.classList.contains('hidden')) {
        document.getElementById('inv-wood-count').innerText = `${p.inventory.wood} / 100`;
        document.getElementById('inv-axe-count').innerText = p.inventory.axe;
        
        // Enable/Disable buttons based on wood count
        document.getElementById('trade-score-btn').disabled = p.inventory.wood < 20;
        document.getElementById('trade-axe-btn').disabled = p.inventory.wood < 5;
        document.getElementById('trade-def-btn').disabled = p.inventory.wood < 1;
    }
}