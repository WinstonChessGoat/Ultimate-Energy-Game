// Load local environment variables from .env file if not in production
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 9000;

// 1. Serve static files (HTML, JS, CSS) from the current folder
app.use(express.static(__dirname));

// 2. WebSocket Room Logic
io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('join-room', (roomId) => {
        currentRoom = roomId;
        socket.join(roomId);
        
        // Notify the room when two players are present
        const clients = io.sockets.adapter.rooms.get(roomId);
        if (clients && clients.size === 2) {
            io.to(roomId).emit('room-ready');
        }
    });

    socket.on('message', (payload) => {
        if (currentRoom) {
            socket.to(currentRoom).emit('message', payload);
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom) {
            socket.to(currentRoom).emit('opponent-disconnected');
        }
    });
});

server.listen(port, () => {
    console.log(`Server is running in ${process.env.NODE_ENV || 'development'} mode on port ${port}`);
});