require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const fs         = require('fs');
const cors       = require('cors');
const { WebSocketServer } = require('ws');
const authRoutes   = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const eventRoutes  = require('./routes/events');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    allowEIO3: true,
});

app.use(cors({ origin: '*' }));
app.use(express.json());
app.get('/health', (_, res) => res.status(200).json({ status: 'ok' }));

const uploadDir = process.env.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

app.use('/auth',    authRoutes);
app.use('/devices', deviceRoutes);
app.use('/events',  eventRoutes(io));

// ── Flash toggle ──
const { verifyJWT } = require('./routes/middleware');
app.post('/devices/:deviceId/flash', verifyJWT, (req, res) => {
    const { deviceId } = req.params;
    const cam = camSockets.get(deviceId);
    if (!cam || cam.readyState !== 1) {
        return res.status(503).json({ error: 'Camara no conectada' });
    }
	setInterval(() => {
		camSockets.forEach((ws, deviceId) => {
			if (ws.readyState === 1) {
				ws.ping();
			} else {
				camSockets.delete(deviceId);
			}
		});
	}, 10000); // cada 10s
    cam.send(JSON.stringify({ cmd: 'flash' }));
    res.json({ ok: true });
});

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

// ── WebSocket nativo: ESP32 y Flutter ──
const wss = new WebSocketServer({ noServer: true });

const camSockets    = new Map(); // deviceId -> ws del ESP32
const clientSockets = new Map(); // deviceId -> Set de ws de Flutter

wss.on('connection', (ws, req, type, deviceId) => {
    if (type === 'cam') {
        console.log(`[CAM-WS] ESP32 conectado: ${deviceId}`);
        camSockets.set(deviceId, ws);

        ws.on('message', (data, isBinary) => {
            if (!isBinary) return;
            const b64 = data.toString('base64');
            const frameData = {
                device_id: deviceId,
                image: `data:image/jpeg;base64,${b64}`
            };
            // Web via Socket.IO
            io.to(deviceId).emit('frame', frameData);
            // Flutter via WebSocket nativo
            const payload = JSON.stringify(frameData);
            clientSockets.get(deviceId)?.forEach(client => {
                if (client.readyState === 1) client.send(payload);
            });
        });

        ws.on('close', () => {
            console.log(`[CAM-WS] ESP32 desconectado: ${deviceId}`);
            camSockets.delete(deviceId);
            io.to(deviceId).emit('cam_offline', { device_id: deviceId });
            const offlineMsg = JSON.stringify({ type: 'cam_offline', device_id: deviceId });
            clientSockets.get(deviceId)?.forEach(client => {
                if (client.readyState === 1) client.send(offlineMsg);
            });
        });

        ws.on('error', (err) => console.error(`[CAM-WS] Error ${deviceId}:`, err.message));

    } else if (type === 'client') {
        console.log(`[CLIENT-WS] Flutter conectado a device: ${deviceId}`);
        if (!clientSockets.has(deviceId)) clientSockets.set(deviceId, new Set());
        clientSockets.get(deviceId).add(ws);

        // Enviar fall_alert via WebSocket a Flutter
        ws.on('message', (data) => {
            // Por ahora solo recibimos, no procesamos mensajes del cliente
        });

        ws.on('close', () => {
            console.log(`[CLIENT-WS] Flutter desconectado de device: ${deviceId}`);
            clientSockets.get(deviceId)?.delete(ws);
        });

        ws.on('error', (err) => console.error(`[CLIENT-WS] Error ${deviceId}:`, err.message));
    }
});

// ── Upgrade HTTP -> WebSocket ──
server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/socket.io')) return;

    const camMatch = req.url.match(/^\/ws\/stream\/(.+)$/);
    if (camMatch) {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req, 'cam', camMatch[1]);
        });
        return;
    }

    const clientMatch = req.url.match(/^\/ws\/client\/(.+)$/);
    if (clientMatch) {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req, 'client', clientMatch[1]);
        });
        return;
    }
});

// ── Emitir fall_alert a Flutter cuando llega via Socket.IO ──
// El evento se emite desde events.js via io.to(deviceId).emit('fall_alert', ...)
// Para Flutter lo reenviamos via WebSocket nativo
io.on('connection', (socket) => {
    socket.onAny((event, data) => {
        if (event === 'fall_alert' && data?.device_id) {
            const payload = JSON.stringify({ type: 'fall_alert', ...data });
            clientSockets.get(data.device_id)?.forEach(client => {
                if (client.readyState === 1) client.send(payload);
            });
        }
    });
});

app.set('io', io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[CASCO] Backend corriendo en puerto ${PORT}`);
});