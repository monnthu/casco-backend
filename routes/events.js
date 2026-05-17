const express   = require('express');
const multer    = require('multer');
const pool      = require('../db');
const supabase  = require('../supabase');
const { verifyDevice } = require('./middleware');
const router    = express.Router();

// Multer en memoria — no guardar en disco, subir directo a Supabase
const upload = multer({ storage: multer.memoryStorage() });

module.exports = (io) => {

    // POST /events  (alerta sin video)
    router.post('/', verifyDevice, async (req, res) => {
        const { device_id, event, timestamp } = req.body;
        try {
            const result = await pool.query(
                `INSERT INTO events (device_id, event_type, triggered_at)
                 VALUES ($1, $2, to_timestamp($3::bigint / 1000.0))
                 RETURNING id`,
                [device_id, event || 'fall', timestamp]
            );

            io.to(device_id).emit('fall_alert', {
                device_id,
                event_id: result.rows[0].id,
                timestamp
            });

            res.status(201).json({ event_id: result.rows[0].id });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // POST /events/upload  (clip de video)
    router.post('/upload', verifyDevice, upload.single('file'), async (req, res) => {
        const { device_id, timestamp } = req.body;

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
                    const { data } = supabase
                        .storage
                        .from('casco-clips')
                        .getPublicUrl(filename);
                    clip_url = data.publicUrl;
                }
            }

            const result = await pool.query(
                `INSERT INTO events (device_id, event_type, triggered_at, clip_url)
                 VALUES ($1, 'fall', to_timestamp($2::bigint / 1000.0), $3)
                 RETURNING id`,
                [device_id, timestamp, clip_url]
            );

            io.to(device_id).emit('fall_alert', {
                device_id,
                event_id: result.rows[0].id,
                clip_url,
                timestamp
            });

            res.status(201).json({ event_id: result.rows[0].id, clip_url });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // POST /events/snapshot  (snapshot periódico)
    router.post('/snapshot', verifyDevice, upload.single('file'), async (req, res) => {
        const { device_id } = req.body;

        try {
            if (!req.file) return res.status(400).json({ error: 'Sin imagen' });

            const filename = `${device_id}/snapshot.jpg`;

            // Sobreescribe siempre el mismo archivo — solo importa el último
            const { error: uploadError } = await supabase
                .storage
                .from('casco-clips')
                .upload(filename, req.file.buffer, {
                    contentType: 'image/jpeg',
                    upsert: true
                });

            if (uploadError)
                return res.status(500).json({ error: uploadError.message });

            const { data } = supabase
                .storage
                .from('casco-clips')
                .getPublicUrl(filename);

            // Emitir snapshot en tiempo real
            io.to(device_id).emit('snapshot', {
                device_id,
                snapshot_url: data.publicUrl,
                timestamp: Date.now()
            });

            res.status(200).json({ snapshot_url: data.publicUrl });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /events/:deviceId
    router.get('/:deviceId', verifyDevice, async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT * FROM events WHERE device_id = $1
                 ORDER BY triggered_at DESC LIMIT 50`,
                [req.params.deviceId]
            );
            res.json(result.rows);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};