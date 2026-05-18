require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const fs         = require('fs');
const cors       = require('cors');
const { verifyJWT, verifyDeviceHeader } = require('./routes/middleware');
const authRoutes   = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const eventRoutes  = require('./routes/events');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors({ origin: 'https://casco-web.vercel.app' }));

// /stream/frame va ANTES de express.json() para poder leer el body raw
app.post('/stream/frame', verifyDeviceHeader, (req, res) => {
    const device_id = req.headers['x-device-id'];
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        const imageData = Buffer.concat(chunks).toString('base64');
        io.to(device_id).emit('frame', {
            device_id,
            image: `data:image/jpeg;base64,${imageData}`
        });
        res.status(200).end();
    });
});

app.use(express.json());
app.get('/health', (_, res) => res.status(200).json({ status: 'ok' }));
app.use('/uploads', express.static(process.env.UPLOAD_DIR || 'uploads'));

const uploadDir = process.env.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

app.use('/auth',    authRoutes);
app.use('/devices', deviceRoutes);
app.use('/events',  eventRoutes(io));

app.get('/stream/:deviceId', verifyJWT, (req, res) => {
    const camIp = req.query.ip;
    if (!camIp) return res.status(400).end();
    http.get(`http://${camIp}/stream`, camRes => {
        res.set('Content-Type', camRes.headers['content-type']);
        res.set('Cache-Control', 'no-cache');
        camRes.pipe(res);
    }).on('error', () => res.status(502).end());
});

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

app.set('io', io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[CASCO] Backend corriendo en puerto ${PORT}`);
});