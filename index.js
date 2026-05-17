const express = require('express');
const http = require('http');
const { ExpressPeerServer } = require('peer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 9000;

// 1. Serve static files (HTML, JS, CSS) from the current folder
app.use(express.static(__dirname));

// 2. Setup PeerServer middleware
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/myapp'
});

app.use(peerServer);

server.listen(port, () => {
    console.log(`Server is running and serving the game on port ${port}`);
});