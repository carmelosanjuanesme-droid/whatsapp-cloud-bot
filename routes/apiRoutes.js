const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { dbState, initMongoDB, cargarDatosDesdeMongoDB, registrarLogConexion } = require('../config/database');
const { buscarContenidosUniversal, procesarComandoIAEntrante } = require('../services/aiAgentService');
const { getSockInstance, connectToWhatsApp } = require('../core/whatsappClient');

const authDir = path.join(__dirname, '..', 'baileys_auth_info');

// 📊 ESTADO GLOBAL DEL SERVIDOR
router.get('/status', (req, res) => {
    res.json({
        status: dbState.connectionStatus,
        qr: dbState.qrCodeDataUrl,
        events: dbState.lastEvents,
        photos: dbState.savedPhotos,
        hvs: dbState.savedHvs,
        audios: dbState.savedAudios,
        reminders: dbState.capturedReminders,
        forwardingRules: dbState.forwardingRules,
        cleanupLog: dbState.cleanupLog,
        uptimeLogs: dbState.uptimeLogs,
        contactsCount: Object.keys(dbState.savedContacts).length
    });
});

// 🔄 RECARGA AUTOMÁTICA DE TODOS LOS ESCENARIOS DESDE MONGODB
router.get('/reload-latest-files', async (req, res) => {
    try {
        const db = await initMongoDB();
        if (db) {
            await cargarDatosDesdeMongoDB();
        }
        res.json({
            success: true,
            status: dbState.connectionStatus,
            photos: dbState.savedPhotos,
            hvs: dbState.savedHvs,
            audios: dbState.savedAudios,
            reminders: dbState.capturedReminders,
            events: dbState.lastEvents,
            uptimeLogs: dbState.uptimeLogs,
            timestamp: new Date().toLocaleTimeString('es-CO')
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🔍 BÚSQUEDA UNIVERSAL
router.get('/search-content', async (req, res) => {
    try {
        const query = req.query.q || '';
        const resultado = await buscarContenidosUniversal(query);
        res.json({ success: true, ...resultado });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🤖 EJECUTAR COMANDO DE IA
router.post('/execute-ai-command', async (req, res) => {
    try {
        const { command, chatName } = req.body;
        if (!command || typeof command !== 'string') {
            return res.status(400).json({ success: false, error: 'Comando requerido' });
        }

        let targetJid = null;
        let targetGroup = chatName || 'Web Dashboard';
        if (chatName) {
            const query = chatName.toLowerCase();
            for (const jid in dbState.savedContacts) {
                const c = dbState.savedContacts[jid];
                const name = (c.name || c.notify || '').toLowerCase();
                if (name.includes(query)) {
                    targetJid = jid;
                    targetGroup = c.name || c.notify || targetGroup;
                    break;
                }
            }
        }

        const procesado = await procesarComandoIAEntrante(targetJid, command, 'Web Admin', targetGroup, getSockInstance);
        res.json({ success: true, comando: command, chat: targetGroup, procesado });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 👥 CREAR GRUPO DESDE LISTA / ARCHIVO
router.post('/create-group-from-list', async (req, res) => {
    try {
        const { groupName, numbersList } = req.body;
        if (!groupName) return res.status(400).json({ success: false, error: 'Nombre de grupo requerido' });

        const sock = getSockInstance();
        if (!sock) return res.status(500).json({ success: false, error: 'Socket de WhatsApp no conectado' });

        const rawNumbers = (numbersList || '').split('\n').map(n => n.trim().replace(/\D/g, '')).filter(n => n.length >= 8);
        const participants = rawNumbers.map(n => n.includes('@s.whatsapp.net') ? n : `${n}@s.whatsapp.net`);

        if (participants.length === 0) {
            return res.status(400).json({ success: false, error: 'No se encontraron números válidos' });
        }

        const group = await sock.groupCreate(groupName, participants);
        console.log(`✅ Grupo "${groupName}" creado con exito (${group.id}) con ${participants.length} participantes.`);

        res.json({
            success: true,
            groupId: group.id,
            groupName: groupName,
            totalAgregados: participants.length
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🧹 RESETEAR SESIÓN
router.post('/reset-session', async (req, res) => {
    try {
        if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
        
        const db = await initMongoDB();
        if (db) {
            await db.collection('baileys_atomic_auth').deleteMany({});
        }

        dbState.connectionStatus = 'DESCONECTADO';
        dbState.qrCodeDataUrl = null;

        setTimeout(connectToWhatsApp, 2000);
        res.json({ success: true, message: 'Sesión reiniciada con éxito. Se generará un nuevo QR limpio.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 📡 LOGS DE UPTIME
router.get('/uptime-logs', (req, res) => {
    res.json({ success: true, status: dbState.connectionStatus, logs: dbState.uptimeLogs });
});

module.exports = router;
