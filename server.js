require('dotenv').config();
const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const fs        = require('fs');
const path      = require('path');

const authRoutes    = require('./routes/auth');
const deviceRoutes  = require('./routes/devices');
const eventRoutes   = require('./routes/events');

const http = require('http');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: '*' }
});

const cors = require('cors');
app.use(cors({ origin: 'https://casco-web.vercel.app' }));

// ─── Middleware ───
app.use(express.json());
app.get('/health', (_, res) => res.status(200).json({ status: 'ok' }));
app.use('/uploads', express.static(process.env.UPLOAD_DIR || 'uploads'));

// Crear carpeta uploads si no existe
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// ─── Rutas ───
app.use('/auth',    authRoutes);
app.use('/devices', deviceRoutes);
app.use('/events',  eventRoutes(io));  // io para emitir alerts

// ─── Socket.IO ───
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

app.get('/stream/:deviceId', verifyJWT, (req, res) => {
    const camIp = req.query.ip;
    if (!camIp) return res.status(400).end();

    http.get(`http://${camIp}/stream`, camRes => {
        res.set('Content-Type', camRes.headers['content-type']);
        res.set('Cache-Control', 'no-cache');
        camRes.pipe(res);
    }).on('error', () => res.status(502).end());
});

// Exponer io para usarlo en rutas
app.set('io', io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[CASCO] Backend corriendo en puerto ${PORT}`);
});