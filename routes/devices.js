const express = require('express');
const pool    = require('../db');
const { verifyJWT, verifyDevice } = require('./middleware');
const router  = express.Router();

// POST /devices/register  (usuario autenticado registra un casco)
router.post('/register', verifyJWT, async (req, res) => {
    const { device_id, api_token } = req.body;
    if (!device_id || !api_token)
        return res.status(400).json({ error: 'Faltan campos' });

    try {
        await pool.query(
            `INSERT INTO devices (device_id, owner_id, api_token)
             VALUES ($1, $2, $3)
             ON CONFLICT (device_id) DO UPDATE SET api_token = $3`,
            [device_id, req.user.id, api_token]
        );
        res.status(201).json({ ok: true });
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

module.exports = router;