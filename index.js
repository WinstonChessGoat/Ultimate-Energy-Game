const { PeerServer } = require('peer');

// Render provides the port via environment variables
const port = process.env.PORT || 9000;

const peerServer = PeerServer({
    port: port,
    path: '/myapp',
    allow_discovery: true,
    // Adding a key if you want to restrict access, 
    // though it defaults to 'peerjs' if not specified.
});

peerServer.on('connection', (client) => {
    console.log(`[${new Date().toLocaleTimeString()}] Player connected: ${client.id}`);
});

peerServer.on('disconnect', (client) => {
    console.log(`[${new Date().toLocaleTimeString()}] Player disconnected: ${client.id}`);
});

console.log(`PeerJS Server is running on port ${port}`);