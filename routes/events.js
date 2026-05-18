const express   = require('express');
const multer    = require('multer');
const pool      = require('../db');
const supabase  = require('../supabase');
const { verifyDevice, verifyDeviceHeader } = require('./middleware');
const router    = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

module.exports = (io) => {

    // POST /events  (alerta sin video)
    router.post('/', verifyDevice, async (req, res) => {
        const { device_id, event } = req.body;
        try {
            const result = await pool.query(
                `INSERT INTO events (device_id, event_type, triggered_at)
                 VALUES ($1, $2, NOW())
                 RETURNING id, triggered_at`,
                [device_id, event || 'fall']
            );
            const row = result.rows[0];
            io.to(device_id).emit('fall_alert', {
                device_id,
                event_id:     row.id,
                triggered_at: row.triggered_at,
            });
            res.status(201).json({ event_id: row.id });
        } catch (err) {
            console.error('[POST /events]', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /events/upload  (clip de video)
    router.post('/upload', verifyDevice, upload.single('file'), async (req, res) => {
        const device_id = req.body?.device_id || req.device?.device_id;
        try {
            let clip_url = null;
            if (req.file) {
                const filename = `${device_id}/${Date.now()}.mjpeg`;
                const { error: uploadError } = await supabase
                    .storage
                    .from('casco-clips')
                    .upload(filename, req.file.buffer, {
                        contentType: 'video/x-motion-jpeg',
                        upsert: false
                    });
                if (uploadError) {
                    console.error('[UPLOAD] Supabase error:', uploadError.message);
                } else {
                    const { data } = supabase.storage
                        .from('casco-clips')
                        .getPublicUrl(filename);
                    clip_url = data.publicUrl;
                }
            }
            const result = await pool.query(
                `INSERT INTO events (device_id, event_type, triggered_at, clip_url)
                 VALUES ($1, 'fall', NOW(), $2)
                 RETURNING id, triggered_at`,
                [device_id, clip_url]
            );
            const row = result.rows[0];
            io.to(device_id).emit('fall_alert', {
                device_id,
                event_id:     row.id,
                clip_url,
                triggered_at: row.triggered_at,
            });
            res.status(201).json({ event_id: row.id, clip_url });
        } catch (err) {
            console.error('[POST /events/upload]', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /events/snapshot
    router.post('/snapshot', verifyDevice, upload.single('file'), async (req, res) => {
        const device_id = req.body?.device_id || req.device?.device_id;
        try {
            if (!req.file) return res.status(400).json({ error: 'Sin imagen' });
            const filename = `${device_id}/snapshot.jpg`;
            const { error: uploadError } = await supabase
                .storage
                .from('casco-clips')
                .upload(filename, req.file.buffer, {
                    contentType: 'image/jpeg',
                    upsert: true
                });
            if (uploadError)
                return res.status(500).json({ error: uploadError.message });
            const { data } = supabase.storage
                .from('casco-clips')
                .getPublicUrl(filename);
            io.to(device_id).emit('snapshot', {
                device_id,
                snapshot_url: data.publicUrl,
                timestamp: Date.now()
            });
            res.status(200).json({ snapshot_url: data.publicUrl });
        } catch (err) {
            console.error('[POST /events/snapshot]', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /events/:deviceId — JWT de usuario (frontend)
    // CORRECCIÓN: verifyJWT en lugar de verifyDevice — el frontend envía
    // el token del usuario logueado, no el api_token del dispositivo ESP32
    router.get('/:deviceId', verifyJWT, async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT * FROM events WHERE device_id = $1
                 ORDER BY triggered_at DESC LIMIT 50`,
                [req.params.deviceId]
            );
            res.json(result.rows);
        } catch (err) {
            console.error('[GET /events]', err.message);
            res.status(500).json({ error: err.message });
        }
    });
	
	// POST /stream/frame
	router.post('/stream/frame', verifyDeviceHeader, (req, res) => {
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

    return router;
};