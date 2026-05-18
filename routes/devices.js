const express = require('express');
const pool    = require('../db');
const { verifyJWT, verifyDevice } = require('./middleware');
const router  = express.Router();

// POST /devices/link  (usuario vincula dispositivo a su cuenta)
router.post('/link', verifyJWT, async (req, res) => {
    const { device_id } = req.body;
    if (!device_id) return res.status(400).json({ error: 'Falta device_id' });

    try {
        const existing = await pool.query(
            'SELECT * FROM devices WHERE device_id = $1', [device_id]
        );

        if (existing.rows.length === 0)
            return res.status(404).json({ error: 'Device ID no encontrado' });

        await pool.query(
            'UPDATE devices SET owner_id = $1 WHERE device_id = $2',
            [req.user.id, device_id]
        );

        res.status(200).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /devices/auto-register  (el casco se registra solo)
router.post('/auto-register', async (req, res) => {
    const { device_id } = req.body;
    if (!device_id) return res.status(400).json({ error: 'Falta device_id' });

    try {
        // Verificar si ya existe
        const existing = await pool.query(
            'SELECT * FROM devices WHERE device_id = $1', [device_id]
        );

        if (existing.rows.length > 0) {
            // Ya existe — devolver token existente
            return res.status(200).json({
                api_token: existing.rows[0].api_token
            });
        }

        // Generar API token automático
        const crypto = require('crypto');
        const api_token = crypto.randomBytes(24).toString('hex');

        await pool.query(
            `INSERT INTO devices (device_id, api_token)
             VALUES ($1, $2)`,
            [device_id, api_token]
        );

        res.status(201).json({ api_token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /devices  (listar dispositivos del usuario)
router.get('/', verifyJWT, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT device_id, created_at FROM devices WHERE owner_id = $1',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:deviceId', verifyJWT, async (req, res) => {
    const { deviceId } = req.params;
    try {
        await pool.query(
            'UPDATE devices SET owner_id = NULL WHERE device_id = $1 AND owner_id = $2',
            [deviceId, req.user.id]
        );
        res.status(200).json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;