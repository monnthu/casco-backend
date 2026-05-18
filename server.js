require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const fs         = require('fs');
const cors       = require('cors');
const { verifyJWT } = require('./routes/middleware');
const authRoutes   = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const eventRoutes  = require('./routes/events');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors({ origin: 'https://casco-web.vercel.app' }));
app.use(express.json());
app.get('/health', (_, res) => res.status(200).json({ status: 'ok' }));

const uploadDir = process.env.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

app.use('/auth',    authRoutes);
app.use('/devices', deviceRoutes);
app.use('/events',  eventRoutes(io));

// ── Socket.IO: clientes web ──
io.on('connection', (socket) => {
    console.log(`[WS] Cliente conectado: ${socket.id}`);
    socket.on('join_device', (deviceId) => {
        socket.join(deviceId);
        console.log(`[WS] ${socket.id} escuchando device: ${deviceId}`);
    });
    socket.on('disconnect', () => {
        console.log(`[WS] Cliente desconectado: ${socket.id}`);
    });
});

// ── WebSocket nativo: stream desde ESP32 ──
// El ESP32 se conecta a wss://backend/ws/stream/:deviceId
// y envía frames JPEG como mensajes binarios
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true });

// Map de conexiones activas: deviceId -> ws
const camSockets = new Map();

wss.on('connection', (ws, deviceId) => {
    console.log(`[CAM-WS] ESP32 conectado: ${deviceId}`);
    camSockets.set(deviceId, ws);

    ws.on('message', (data, isBinary) => {
        if (!isBinary) {
            // Primer mensaje de identificación JSON — ignorar, ya tenemos deviceId
            return;
        }
        // Frame JPEG binario — convertir a base64 y emitir a los clientes web
        const b64 = data.toString('base64');
        io.to(deviceId).emit('frame', {
            device_id: deviceId,
            image: `data:image/jpeg;base64,${b64}`
        });
    });

    ws.on('close', () => {
        console.log(`[CAM-WS] ESP32 desconectado: ${deviceId}`);
        camSockets.delete(deviceId);
        io.to(deviceId).emit('cam_offline', { device_id: deviceId });
    });

    ws.on('error', (err) => {
        console.error(`[CAM-WS] Error ${deviceId}:`, err.message);
    });
});

// Upgrade HTTP -> WebSocket solo para /ws/stream/:deviceId
server.on('upgrade', (req, socket, head) => {
    const match = req.url.match(/^\/ws\/stream\/(.+)$/);
    if (!match) {
        socket.destroy();
        return;
    }
    const deviceId = match[1];
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, deviceId);
    });
});

app.set('io', io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[CASCO] Backend corriendo en puerto ${PORT}`);
});