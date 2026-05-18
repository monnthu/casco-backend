require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/health', (_, res) => res.status(200).json({ status: 'ok' }));

io.on('connection', (socket) => {
    console.log(`[WS] Cliente conectado: ${socket.id}`);
    socket.on('join_device', (deviceId) => {
        socket.join(deviceId);
        console.log(`[WS] ${socket.id} join: ${deviceId}`);
    });
    socket.on('disconnect', () => {
        console.log(`[WS] Desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[CASCO] Puerto ${PORT}`));