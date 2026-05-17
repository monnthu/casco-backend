const express = require('express');
const multer  = require('multer');
const path    = require('path');
const pool    = require('../db');
const { verifyDevice } = require('./middleware');
const router  = express.Router();

const storage = multer.diskStorage({
    destination: process.env.UPLOAD_DIR || 'uploads',
    filename: (req, file, cb) => {
        const name = `${Date.now()}_${req.body.device_id || 'unknown'}.mjpeg`;
        cb(null, name);
    }
});
const upload = multer({ storage });

module.exports = (io) => {

    // POST /events  (alerta de caída sin video)
    router.post('/', verifyDevice, async (req, res) => {
        const { device_id, event, timestamp } = req.body;
        try {
            const result = await pool.query(
                `INSERT INTO events (device_id, event_type, triggered_at)
                 VALUES ($1, $2, to_timestamp($3::bigint / 1000.0))
                 RETURNING id`,
                [device_id, event || 'fall', timestamp]
            );

            // Emitir alerta en tiempo real
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

    // POST /events/upload  (clip de video del evento)
    router.post('/upload', verifyDevice, upload.single('file'), async (req, res) => {
        const { device_id, timestamp } = req.body;
        const filename = req.file ? req.file.filename : null;

        try {
            const result = await pool.query(
                `INSERT INTO events (device_id, event_type, triggered_at, clip_filename)
                 VALUES ($1, 'fall', to_timestamp($2::bigint / 1000.0), $3)
                 RETURNING id`,
                [device_id, timestamp, filename]
            );

            io.to(device_id).emit('fall_alert', {
                device_id,
                event_id: result.rows[0].id,
                clip: filename,
                timestamp
            });

            res.status(201).json({ event_id: result.rows[0].id, clip: filename });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /events/:deviceId
    router.get('/:deviceId', verifyDevice, async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT * FROM events WHERE device_id = $1 ORDER BY triggered_at DESC LIMIT 50`,
                [req.params.deviceId]
            );
            res.json(result.rows);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};