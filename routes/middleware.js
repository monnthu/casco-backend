const jwt  = require('jsonwebtoken');
const pool = require('../db');

// Verificar JWT de usuario
function verifyJWT(req, res, next) {
    const header = req.headers['authorization'];
    if (!header) return res.status(401).json({ error: 'Sin token' });

    const token = header.split(' ')[1];
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido' });
    }
}

// Verificar API token del dispositivo
async function verifyDevice(req, res, next) {
    const header = req.headers['authorization'];
    if (!header) return res.status(401).json({ error: 'Sin token' });

    const token     = header.split(' ')[1];
    const device_id = req.body.device_id || req.params.deviceId;

    try {
        const result = await pool.query(
            'SELECT * FROM devices WHERE device_id = $1 AND api_token = $2',
            [device_id, token]
        );
        if (result.rows.length === 0)
            return res.status(401).json({ error: 'Dispositivo no autorizado' });
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = { verifyJWT, verifyDevice };