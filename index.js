const { PeerServer } = require('peer');

// Render will automatically assign a port through process.env.PORT
const port = process.env.PORT || 9000; 

const peerServer = PeerServer({ 
    port: port, 
    path: '/myapp',
    allow_discovery: true 
});

peerServer.on('connection', (client) => {
    console.log('Player connected to signaling server:', client.id);
});

peerServer.on('disconnect', (client) => {
    console.log('Player disconnected from signaling server:', client.id);
});

console.log(`PeerJS Server is running on port ${port}`);