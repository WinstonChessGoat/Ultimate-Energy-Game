// Load local environment variables from .env file if not in production
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server }); // The "Brain" that listens for new WebSocket connections
const port = process.env.PORT || 9000;

// Initialize Database
const db = new sqlite3.Database('./scores.db');
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS scores (username TEXT PRIMARY KEY, score INTEGER)");
});

app.use(express.json());

// Manage rooms: RoomID -> Set of sockets
const rooms = new Map();

// 1. Serve static files (HTML, JS, CSS) from the current folder
app.use(express.static(__dirname));

// 2. WebSocket Room Logic
wss.on('connection', (ws, req) => {
    const roomId = req.url.slice(1); // Extract ID from URL path (remove leading /)
    if (!roomId) return; 

    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    const clients = rooms.get(roomId);

    // Enforce 1v1 limit
    if (clients.size >= 2) {
        safeSend(ws, { type: 'ERROR', msg: 'Room is full!' });
        ws.close();
        return;
    }

    console.log(`[Server] Client connected to room ${roomId}`);
    ws.roomId = roomId;
    clients.add(ws);

    // Assign role and check if ready
    const role = (clients.size === 1) ? 'p1' : 'p2';
    safeSend(ws, { type: 'assign-role', role });

    if (clients.size === 2) {
        // Broadcast to both players that the match can start
        broadcastToRoom(roomId, { type: 'room-ready' });
    }

    ws.on('message', (data, isBinary) => {
        // Relay message to the other person in the room
        const roomClients = rooms.get(ws.roomId);
        if (roomClients) {
            roomClients.forEach(client => {
                // Relay the message ONLY to the opponent (the other person in the room)
                if (client !== ws && client.readyState === 1) { // 1 = OPEN
                    client.send(data, { binary: isBinary }); 
                }
            });
        }
    });

    ws.on('close', () => {
        console.log(`[Server] Client disconnected from room ${ws.roomId}`);
        const roomClients = rooms.get(ws.roomId);
        if (roomClients) {
            roomClients.delete(ws);
            if (roomClients.size === 0) {
                rooms.delete(ws.roomId);
            } else {
                // Tell the remaining player that their opponent left
                broadcastToRoom(ws.roomId, { type: 'opponent-disconnected' });
            }
        }
    });

    ws.on('error', (err) => console.error(`[Server] Socket error on room ${ws.roomId}:`, err));
});

/**
 * Safely sends a JSON object to a specific client
 */
function safeSend(ws, payload) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
    }
}

/**
 * Sends a message to everyone currently in a specific room
 */
function broadcastToRoom(roomId, payload) {
    const clients = rooms.get(roomId);
    if (clients) {
        const msg = JSON.stringify(payload);
        clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(msg);
            }
        });
    }
}

// Database API Routes
app.get('/api/score/:username', (req, res) => {
    const username = req.params.username;
    db.get("SELECT score FROM scores WHERE username = ?", [username], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ score: row ? row.score : 0 });
    });
});

app.get('/api/leaderboard', (req, res) => {
    db.all("SELECT username, score FROM scores ORDER BY score DESC LIMIT 5", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/score', (req, res) => {
    const { username, score } = req.body;
    if (!username) return res.status(400).json({ error: "Username required" });
    
    const sql = `INSERT INTO scores (username, score) 
                 VALUES (?, ?) 
                 ON CONFLICT(username) 
                 DO UPDATE SET score = excluded.score`;
                 
    db.run(sql, [username, score], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

server.listen(port, () => {
    console.log(`Server is running in ${process.env.NODE_ENV || 'development'} mode on port ${port}`);
});