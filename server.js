const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
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

// Asegurar carpeta para descargas de fotos recibidas
const photosDir = path.join(__dirname, 'public', 'downloads', 'photos');
if (!fs.existsSync(photosDir)) {
    fs.mkdirSync(photosDir, { recursive: true });
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

// Palabras clave predeterminadas para detectar lluvias y tiempos muertos
const WEATHER_KEYWORDS = [
    'lluvia', 'lloviendo', 'llovizna', 'tiempo muerto',
    'parado', 'suspens', 'clima', 'tormenta', 'agua', 'mixer'
];

// Palabras clave para agendamiento de citas
const CALENDAR_KEYWORDS = [
    'reunión', 'reunion', 'cita', 'nos vemos', 'agendar',
    'mañana a las', 'el viernes', 'el lunes', 'revisión de planos', 'compromiso'
];

console.log('Iniciando Hub Multifuncional de WhatsApp 24/7...');

// Configuración de Puppeteer para Linux Docker / Render / PC
const puppeteerArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
];

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },
    puppeteer: {
        headless: true,
        args: puppeteerArgs,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    }
});

// Eventos de estado WhatsApp
client.on('qr', async (qr) => {
    console.log('📌 Código QR generado. Escanéalo desde tu iPhone.');
    connectionStatus = 'ESPERANDO_QR';
    try {
        qrCodeDataUrl = await qrcode.toDataURL(qr);
        io.emit('status-update', { status: connectionStatus, qr: qrCodeDataUrl });
    } catch (err) {
        console.error('Error generando QR DataURL:', err);
    }
});

client.on('authenticated', () => {
    console.log('✅ Autenticado con éxito en WhatsApp.');
    connectionStatus = 'AUTENTICADO';
    qrCodeDataUrl = null;
    io.emit('status-update', { status: connectionStatus, qr: null });
});

client.on('ready', () => {
    console.log('🚀 Hub de WhatsApp conectado y ejecutando los 4 Módulos en la nube.');
    connectionStatus = 'CONECTADO_24_7';
    qrCodeDataUrl = null;
    io.emit('status-update', { status: connectionStatus, qr: null });
});

client.on('disconnected', (reason) => {
    console.log('⚠️ Cliente desconectado:', reason);
    connectionStatus = 'DESCONECTADO';
    qrCodeDataUrl = null;
    io.emit('status-update', { status: connectionStatus, qr: null });
});

// -------------------------------------------------------------
// EVENTO PRINCIPAL: PROCESAMIENTO DE MENSAJES CON LOS 4 MÓDULOS
// -------------------------------------------------------------
client.on('message', async (msg) => {
    try {
        const text = msg.body ? msg.body.trim() : '';
        const chat = await msg.getChat();
        const contact = await msg.getContact();

        const groupName = chat.isGroup ? chat.name : (contact.pushname || contact.name || msg.from);
        const senderName = contact.pushname || contact.name || msg.from;

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0];

        // ═════════════════════════════════════════════════════════
        // MÓDULO 1: DESCARGA, RENOMBRADO Y ORGANIZACIÓN DE FOTOS
        // ═════════════════════════════════════════════════════════
        if (msg.hasMedia) {
            try {
                const media = await msg.downloadMedia();
                if (media && media.mimetype && media.mimetype.startsWith('image/')) {
                    const ext = media.mimetype.split('/')[1] || 'jpg';
                    const safeGroup = groupName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
                    const safeSender = senderName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 15);
                    const cleanDesc = text.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 25);
                    
                    const filename = `${dateStr}_${safeGroup}_${safeSender}_${cleanDesc || 'Foto'}_${Date.now()}.${ext}`;
                    const filePath = path.join(photosDir, filename);

                    fs.writeFileSync(filePath, media.data, 'base64');

                    const photoRecord = {
                        id: Date.now().toString(),
                        fecha: dateStr,
                        hora: timeStr,
                        proyecto: groupName,
                        remitente: senderName,
                        descripcion: text || 'Sin descripción',
                        filename: filename,
                        url: `/downloads/photos/${filename}`
                    };

                    savedPhotos.unshift(photoRecord);
                    if (savedPhotos.length > 100) savedPhotos.pop();

                    console.log(`📷 [MÓDULO FOTOS] Foto descargada y renombrada: ${filename}`);
                    io.emit('new-photo', photoRecord);
                }
            } catch (mediaErr) {
                console.error('Error al descargar multimedia:', mediaErr.message);
            }
        }

        if (!text) return;
        const textLower = text.toLowerCase();

        // ═════════════════════════════════════════════════════════
        // MÓDULO 2: COPIA Y REENVÍO INTELIGENTE ENTRE CHATS
        // ═════════════════════════════════════════════════════════
        for (const rule of forwardingRules) {
            if (rule.active && textLower.includes(rule.tag.toLowerCase())) {
                console.log(`🔁 [MÓDULO REENVÍO] Mensaje marcado con ${rule.tag} detectado. Buscando chat destino: ${rule.target}`);
                
                // Buscar chat de destino
                const allChats = await client.getChats();
                const targetChat = allChats.find(c => c.name.toLowerCase().includes(rule.target.toLowerCase()));

                if (targetChat) {
                    const forwardContent = `📢 *[MENSAJE COPIADO AUTOMÁTICAMENTE]*\n` +
                                           `📌 *Origen:* ${groupName}\n` +
                                           `👤 *De:* ${senderName}\n` +
                                           `💬 *Mensaje:* ${text}`;
                    
                    await client.sendMessage(targetChat.id._serialized, forwardContent);
                    console.log(`✅ Mensaje reenganchado y enviado con éxito a: ${targetChat.name}`);
                    
                    io.emit('new-log', {
                        tipo: 'REENVÍO',
                        origen: groupName,
                        destino: targetChat.name,
                        mensaje: text
                    });
                } else {
                    console.log(`⚠️ Chat destino "${rule.target}" no encontrado para reenvío.`);
                }
            }
        }

        // ═════════════════════════════════════════════════════════
        // MÓDULO 3: CAPTURA DE CITAS Y RECORDATORIOS
        // ═════════════════════════════════════════════════════════
        const isCalendarEvent = CALENDAR_KEYWORDS.some(kw => textLower.includes(kw));
        if (isCalendarEvent) {
            const reminderRecord = {
                id: Date.now().toString(),
                fechaCaptura: `${dateStr} ${timeStr}`,
                proyecto: groupName,
                remitente: senderName,
                detalle: text,
                estado: 'CAPTURADO'
            };
            capturedReminders.unshift(reminderRecord);
            if (capturedReminders.length > 50) capturedReminders.pop();

            console.log(`📅 [MÓDULO CITAS] Cita/Recordatorio capturado: ${text}`);
            io.emit('new-reminder', reminderRecord);
        }

        // ═════════════════════════════════════════════════════════
        // REGISTRO GENERAL / DE LLUVIAS (GOOGLE SHEETS)
        // ═════════════════════════════════════════════════════════
        const isWeatherEvent = WEATHER_KEYWORDS.some(kw => textLower.includes(kw));
        if (isWeatherEvent) {
            const eventData = {
                fecha: dateStr,
                hora: timeStr,
                proyecto: groupName,
                remitente: senderName,
                mensaje: text
            };

            lastEvents.unshift(eventData);
            if (lastEvents.length > 50) lastEvents.pop();

            io.emit('new-event', eventData);

            if (GOOGLE_WEBHOOK_URL) {
                try {
                    await axios.post(GOOGLE_WEBHOOK_URL, eventData, {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 8000
                    });
                    console.log('📊 Evento enviado a Google Sheets.');
                } catch (apiErr) {
                    console.error('Error Google Sheets Webhook:', apiErr.message);
                }
            }
        }
    } catch (err) {
        console.error('Error procesando mensaje:', err);
    }
});

// ═════════════════════════════════════════════════════════
// MÓDULO 4: LIMPIEZA Y MANTENIMIENTO DE CHATS INACTIVOS (> 6 MESES)
// ═════════════════════════════════════════════════════════
async function ejecutarLimpiezaChatsInactivos(diasInactividad = 180) {
    if (connectionStatus !== 'CONECTADO_24_7') {
        throw new Error('WhatsApp debe estar conectado para ejecutar la limpieza.');
    }

    console.log(`🧹 [MÓDULO LIMPIEZA] Iniciando escaneo de chats inactivos por más de ${diasInactividad} días...`);
    const allChats = await client.getChats();
    const nowMs = Date.now();
    const maxInactivityMs = diasInactividad * 24 * 60 * 60 * 1000;

    let procesados = 0;
    let archivados = 0;
    const detallesLimpieza = [];

    for (const chat of allChats) {
        // Ignorar chats fijados o no leídos si se desea
        if (chat.pinned) continue;

        const lastMsgTimestamp = chat.lastMessage ? (chat.lastMessage.timestamp * 1000) : 0;

        if (lastMsgTimestamp > 0 && (nowMs - lastMsgTimestamp) > maxInactivityMs) {
            const diasDiferencia = Math.floor((nowMs - lastMsgTimestamp) / (1000 * 60 * 60 * 24));
            const chatName = chat.name || chat.id.user;

            try {
                // Archivar el chat inactivo
                await chat.archive();
                archivados++;
                
                detallesLimpieza.push({
                    chat: chatName,
                    diasInactivo: diasDiferencia,
                    accion: 'ARCHIVADO',
                    fechaUltimoMensaje: new Date(lastMsgTimestamp).toISOString().split('T')[0]
                });

                console.log(`  📦 Chat archivado por inactividad: "${chatName}" (${diasDiferencia} días sin mensajes)`);
            } catch (cleanErr) {
                console.error(`Error al archivar chat ${chatName}:`, cleanErr.message);
            }
        }
        procesados++;
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

// -------------------------------------------------------------
// ENDPOINTS REST PARA EL DASHBOARD Y LA API
// -------------------------------------------------------------
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

server.listen(PORT, () => {
    console.log(`🌐 Servidor Hub WhatsApp escuchando en puerto ${PORT}`);
    console.log('Inicializando cliente de WhatsApp...');
    client.initialize().catch(err => console.error('❌ Error inicializando WhatsApp:', err));
});
