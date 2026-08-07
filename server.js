const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GOOGLE_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';
const TARGET_FORWARD_CHAT_NAME = process.env.TARGET_FORWARD_CHAT_NAME || 'Gerencia Ingelec';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Directorio para fotos recibidas
const photosDir = path.join(__dirname, 'public', 'downloads', 'photos');
if (!fs.existsSync(photosDir)) {
    fs.mkdirSync(photosDir, { recursive: true });
}

// Directorio de autenticación
const authDir = path.join(__dirname, 'baileys_auth_info');
if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
}

// Estado global de la aplicación
let connectionStatus = 'INICIALIZANDO';
let qrCodeDataUrl = null;
let lastEvents = [];
let savedPhotos = [];
let capturedReminders = [];
let forwardingRules = [
    { tag: '#urgente', target: TARGET_FORWARD_CHAT_NAME, active: true },
    { tag: '#gerencia', target: TARGET_FORWARD_CHAT_NAME, active: true },
    { tag: '#reporte', target: TARGET_FORWARD_CHAT_NAME, active: true }
];
let cleanupLog = [];

const WEATHER_KEYWORDS = [
    'lluvia', 'lloviendo', 'llovizna', 'tiempo muerto',
    'parado', 'suspens', 'clima', 'tormenta', 'agua', 'mixer'
];

const CALENDAR_KEYWORDS = [
    'reunión', 'reunion', 'cita', 'nos vemos', 'agendar',
    'mañana a las', 'el viernes', 'el lunes', 'revisión de planos', 'compromiso'
];

let sock = null;

async function connectToWhatsApp() {
    console.log('⚡ Iniciando conexión ultraligera a WhatsApp con Baileys...');
    connectionStatus = 'INICIALIZANDO';
    io.emit('status-update', { status: connectionStatus, qr: null });

    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));
    console.log(`📌 Versión de WhatsApp Web obtenida: v${version.join('.')}`);

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📌 Código QR de Baileys generado en <1 segundo. Listo para escanear.');
            connectionStatus = 'ESPERANDO_QR';
            try {
                qrCodeDataUrl = await qrcode.toDataURL(qr);
                io.emit('status-update', { status: connectionStatus, qr: qrCodeDataUrl });
            } catch (err) {
                console.error('Error convirtiendo QR a DataURL:', err);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ Conexión cerrada. Código: ${statusCode}. Reconectando: ${shouldReconnect}`);
            
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 428) {
                console.log('🧹 Limpiando credenciales antiguas para permitir un escaneo fresco...');
                try {
                    fs.rmSync(authDir, { recursive: true, force: true });
                    fs.mkdirSync(authDir, { recursive: true });
                } catch (e) {}
            }

            connectionStatus = 'DESCONECTADO';
            qrCodeDataUrl = null;
            io.emit('status-update', { status: connectionStatus, qr: null });

            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('🚀 ¡Conectado con éxito a WhatsApp 24/7 en la Nube!');
            connectionStatus = 'CONECTADO_24_7';
            qrCodeDataUrl = null;
            io.emit('status-update', { status: connectionStatus, qr: null });
        }
    });

    // PROCESAMIENTO DE MENSAJES ENTRANTES (4 MÓDULOS)
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const fromJid = msg.key.remoteJid;
            const isGroup = fromJid.endsWith('@g.us');
            const senderJid = msg.key.participant || fromJid;
            const senderName = msg.pushName || senderJid.split('@')[0];
            const groupName = isGroup ? (msg.pushName || 'Grupo_WhatsApp') : senderName;

            const textMessage = msg.message.conversation || 
                              msg.message.extendedTextMessage?.text || 
                              msg.message.imageMessage?.caption || 
                              msg.message.videoMessage?.caption || '';
            const textLower = textMessage.toLowerCase();

            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0];

            // 📷 MÓDULO 1: GESTIÓN Y ORGANIZACIÓN DE FOTOS
            if (msg.message.imageMessage) {
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    if (buffer) {
                        const safeGroup = groupName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
                        const safeSender = senderName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 15);
                        const cleanDesc = textMessage.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);

                        const filename = `${dateStr}_${safeGroup}_${safeSender}_${cleanDesc || 'Foto'}_${Date.now()}.jpg`;
                        const filePath = path.join(photosDir, filename);

                        fs.writeFileSync(filePath, buffer);

                        const photoData = {
                            id: Date.now(),
                            fecha: dateStr,
                            hora: timeStr,
                            grupo: groupName,
                            remitente: senderName,
                            descripcion: textMessage || 'Sin descripción',
                            url: `/downloads/photos/${filename}`,
                            nombreArchivo: filename
                        };

                        savedPhotos.unshift(photoData);
                        if (savedPhotos.length > 50) savedPhotos.pop();

                        io.emit('new-photo', photoData);
                        console.log(`📷 Foto guardada y renombrada: ${filename}`);
                    }
                } catch (err) {
                    console.error('Error procesando imagen:', err.message);
                }
            }

            // 🌧️ REGISTRO DE EVENTOS DE CLIMA Y TIEMPOS MUERTOS
            const hasWeatherEvent = WEATHER_KEYWORDS.some(kw => textLower.includes(kw));
            if (hasWeatherEvent && textMessage.length > 0) {
                const eventData = {
                    id: Date.now(),
                    fecha: dateStr,
                    hora: timeStr,
                    proyecto: groupName,
                    remitente: senderName,
                    mensaje: textMessage
                };

                lastEvents.unshift(eventData);
                if (lastEvents.length > 100) lastEvents.pop();

                io.emit('new-event', eventData);
                console.log(`🌧️ Evento de clima/tiempo muerto detectado en ${groupName}`);

                if (GOOGLE_WEBHOOK_URL) {
                    axios.post(GOOGLE_WEBHOOK_URL, eventData).catch(err => {
                        console.error('Error enviando evento a Google Sheets:', err.message);
                    });
                }
            }

            // 📅 MÓDULO 3: CITAS Y RECORDATORIOS
            const hasCalendarEvent = CALENDAR_KEYWORDS.some(kw => textLower.includes(kw));
            if (hasCalendarEvent && textMessage.length > 0) {
                const reminderData = {
                    id: Date.now(),
                    fechaDetec: `${dateStr} ${timeStr}`,
                    origen: groupName,
                    remitente: senderName,
                    mensaje: textMessage,
                    estado: 'Pendiente'
                };

                capturedReminders.unshift(reminderData);
                if (capturedReminders.length > 50) capturedReminders.pop();

                io.emit('new-reminder', reminderData);
                console.log(`📅 Cita/Compromiso detectado: "${textMessage}"`);
            }

            // 🔁 MÓDULO 2: REENVÍO INTELIGENTE ENTRE CHATS
            for (const rule of forwardingRules) {
                if (rule.active && textLower.includes(rule.tag.toLowerCase())) {
                    console.log(`🔁 Reenvío activado por etiqueta ${rule.tag} desde ${groupName}`);
                    
                    const forwardContent = `📢 *[ALERTA REENVIADA DE: ${groupName}]*\n👤 *Remitente:* ${senderName}\n\n💬 ${textMessage}`;
                    
                    try {
                        const groups = await sock.groupFetchAllParticipating();
                        let targetJid = null;

                        for (const jid in groups) {
                            if (groups[jid].subject && groups[jid].subject.toLowerCase().includes(rule.target.toLowerCase())) {
                                targetJid = jid;
                                break;
                            }
                        }

                        if (targetJid) {
                            await sock.sendMessage(targetJid, { text: forwardContent });
                            console.log(`✅ Mensaje reenviado con éxito a ${rule.target}`);
                        } else {
                            console.log(`⚠️ No se encontró el chat de destino: "${rule.target}"`);
                        }
                    } catch (err) {
                        console.error('Error ejecutando reenvío:', err.message);
                    }
                }
            }
        }
    });
}

// 🧹 MÓDULO 4: LIMPIEZA DE CHATS INACTIVOS (> 6 MESES)
async function ejecutarLimpiezaChatsInactivos(diasLimite = 180) {
    if (!sock) throw new Error('Cliente WhatsApp no inicializado');

    console.log(`🧹 Iniciando escaneo de chats inactivos por más de ${diasLimite} días...`);
    const limiteMs = diasLimite * 24 * 60 * 60 * 1000;
    const ahoraMs = Date.now();

    let procesados = 0;
    let archivados = 0;
    const detallesLimpieza = [];

    try {
        const groups = await sock.groupFetchAllParticipating();

        for (const jid in groups) {
            const group = groups[jid];
            procesados++;

            const creationMs = (group.creation || 0) * 1000;
            const antiguedadMs = ahoraMs - creationMs;

            if (antiguedadMs > limiteMs) {
                try {
                    await sock.chatModify({ archive: true }, jid);
                    archivados++;
                    detallesLimpieza.push({
                        nombre: group.subject,
                        jid: jid,
                        accion: 'Archivado por inactividad'
                    });
                } catch (e) {
                    detallesLimpieza.push({
                        nombre: group.subject,
                        jid: jid,
                        accion: `Error archivando: ${e.message}`
                    });
                }
            }
        }
    } catch (err) {
        console.error('Error en escaneo de grupos:', err.message);
    }

    const reportResult = {
        fechaEjecucion: new Date().toISOString(),
        totalEscaneados: procesados,
        totalArchivados: archivados,
        detalles: detallesLimpieza
    };

    cleanupLog.unshift(reportResult);
    if (cleanupLog.length > 20) cleanupLog.pop();

    io.emit('cleanup-completed', reportResult);
    return reportResult;
}

// ENDPOINTS REST
app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: qrCodeDataUrl,
        events: lastEvents,
        photos: savedPhotos,
        reminders: capturedReminders,
        forwardingRules: forwardingRules,
        cleanupLog: cleanupLog
    });
});

app.post('/api/cleanup-chats', async (req, res) => {
    try {
        const dias = req.body.dias || 180;
        const resultado = await ejecutarLimpiezaChatsInactivos(dias);
        res.json({ success: true, resultado });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/forwarding-rules', (req, res) => {
    const { rules } = req.body;
    if (Array.isArray(rules)) {
        forwardingRules = rules;
        io.emit('rules-updated', forwardingRules);
        return res.json({ success: true, forwardingRules });
    }
    res.status(400).json({ success: false, error: 'Formato de reglas inválido' });
});

// WebSocket conexiones
io.on('connection', (socket) => {
    socket.emit('status-update', {
        status: connectionStatus,
        qr: qrCodeDataUrl,
        events: lastEvents,
        photos: savedPhotos,
        reminders: capturedReminders,
        forwardingRules: forwardingRules,
        cleanupLog: cleanupLog
    });
});

server.listen(PORT, () => {
    console.log(`🌐 Servidor Hub WhatsApp (Baileys) escuchando en puerto ${PORT}`);
    connectToWhatsApp().catch(err => {
        console.error('❌ Error conectando a WhatsApp Baileys:', err);
    });
});
