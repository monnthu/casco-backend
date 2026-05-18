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
// CORRECCIÓN: no depender de req.body.device_id porque en requests
// multipart/form-data el body no está parseado cuando corre este middleware.
// En su lugar, validar solo por api_token (header Authorization) y adjuntar
// el device a req.device para que el handler pueda usarlo si lo necesita.
async function verifyDevice(req, res, next) {
    const header = req.headers['authorization'];
    if (!header) return res.status(401).json({ error: 'Sin token' });

    const token = header.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token mal formado' });

    try {
        const result = await pool.query(
            'SELECT * FROM devices WHERE api_token = $1',
            [token]
        );
        if (result.rows.length === 0)
            return res.status(401).json({ error: 'Dispositivo no autorizado' });

        // Adjuntar el device al request para uso opcional en los handlers
        req.device = result.rows[0];
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function verifyDeviceHeader(req, res, next) {
    const header    = req.headers['authorization'];
    const device_id = req.headers['x-device-id'];
    if (!header || !device_id) return res.status(401).json({ error: 'Sin token' });

    const token = header.split(' ')[1];
    try {
        const result = await pool.query(
            'SELECT * FROM devices WHERE device_id = $1 AND api_token = $2',
            [device_id, token]
        );
        if (result.rows.length === 0)
            return res.status(401).json({ error: 'No autorizado' });
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = { verifyJWT, verifyDevice, verifyDeviceHeader };
