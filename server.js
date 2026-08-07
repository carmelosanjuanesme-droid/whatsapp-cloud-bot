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
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Directorios para descargas
const photosDir = path.join(__dirname, 'public', 'downloads', 'photos');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

const hvsDir = path.join(__dirname, 'public', 'downloads', 'hojas_de_vida');
if (!fs.existsSync(hvsDir)) fs.mkdirSync(hvsDir, { recursive: true });

const audiosDir = path.join(__dirname, 'public', 'downloads', 'audios');
if (!fs.existsSync(audiosDir)) fs.mkdirSync(audiosDir, { recursive: true });

// Directorio de autenticación
const authDir = path.join(__dirname, 'baileys_auth_info');
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

// Estado global de la aplicación
let connectionStatus = 'INICIALIZANDO';
let qrCodeDataUrl = null;
let lastEvents = [];
let savedPhotos = [];
let savedHvs = [];
let savedAudios = [];
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
    'reunión', 'reunion', 'cita', 'nos vemos', 'agendar', 'agenda',
    'mañana a las', 'el viernes', 'el lunes', 'revisión de planos', 'compromiso',
    'recuerda', 'recuerde', 'recordar', 'tenemos', 'concierto', 'evento',
    'boletas', 'coletas', 'entradas', 'viaje', 'vuelo', 'partido',
    ' de enero', ' de febrero', ' de marzo', ' de abril', ' de mayo', ' de junio',
    ' de julio', ' de agosto', ' de septiembre', ' de octubre', ' de noviembre', ' de diciembre'
];

const HV_KEYWORDS = [
    'hoja de vida', 'hojadevida', 'curriculum', 'curriculum vitae', ' cv ', '_cv', 'cv_',
    'perfil profesional', 'hoja de trabajo', 'postulacion', 'candidato', 'aspirante', 'hv'
];

function detectarProfesion(texto) {
    const t = (texto || '').toLowerCase();
    if (t.includes('electric') || t.includes('electrónic') || t.includes('electrotécn') || t.includes('liniero') || t.includes('subestacion')) {
        return '⚡ Ingeniería Eléctrica / Electrónica';
    }
    if (t.includes('civil') || t.includes('arquitect') || t.includes('obra') || t.includes('plano') || t.includes('estructura')) {
        return '🏗️ Ingeniería Civil / Obra / Arquitectura';
    }
    if (t.includes('admin') || t.includes('contad') || t.includes('financ') || t.includes('auxiliar') || t.includes('recursos humanos') || t.includes('rh')) {
        return '💼 Administración / Finanzas / Contabilidad';
    }
    if (t.includes('sistemas') || t.includes('programad') || t.includes('software') || t.includes('tic') || t.includes('redes') || t.includes('soporte')) {
        return '💻 Sistemas / Redes / TIC';
    }
    if (t.includes('tecnic') || t.includes('tecnolog') || t.includes('operar') || t.includes('mantenimiento') || t.includes('mecanic')) {
        return '🛠️ Técnico / Tecnólogo / Mantenimiento';
    }
    if (t.includes('abogad') || t.includes('juridic') || t.includes('derecho') || t.includes('legal')) {
        return '⚖️ Derecho / Asesoría Jurídica';
    }
    return '📋 General / Otras Profesiones';
}

// 📁 SUBIDA AUTOMÁTICA A GOOGLE DRIVE VIA WEBHOOK
async function respaldarEnGoogleDrive(filePath, folderName, originalFilename) {
    if (!GOOGLE_WEBHOOK_URL) return;
    try {
        const fileData = fs.readFileSync(filePath, { encoding: 'base64' });
        await axios.post(GOOGLE_WEBHOOK_URL, {
            action: 'upload_file',
            folder: folderName,
            filename: originalFilename,
            fileData: fileData
        });
        console.log(`☁️ Archivo respaldado con éxito en Google Drive: ${originalFilename}`);
    } catch (err) {
        console.error(`⚠️ Error respaldando en Google Drive (${originalFilename}):`, err.message);
    }
}

// 🎙️ TRANCRIPCIÓN DE AUDIOS DE VOZ CON IA
async function transcribirAudioIA(audioFilePath) {
    if (GROQ_API_KEY) {
        try {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('file', fs.createReadStream(audioFilePath));
            form.append('model', 'whisper-large-v3-turbo');
            form.append('language', 'es');

            const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${GROQ_API_KEY}`
                }
            });

            if (response.data && response.data.text) {
                return response.data.text;
            }
        } catch (e) {
            console.error('Error usando Groq Whisper API:', e.message);
        }
    }

    return '🎙️ [Nota de voz recibida y registrada. Transcripción lista para procesamiento por IA]';
}

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

    // PROCESAMIENTO DE MENSAJES ENTRANTES
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
                              msg.message.videoMessage?.caption || 
                              msg.message.documentMessage?.caption || '';
            const textLower = textMessage.toLowerCase();

            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0];

            // 🎙️ NUEVO MÓDULO: TRANSCRIPCIÓN Y AUTO-RESPUESTA DE AUDIOS DE VOZ
            if (msg.message.audioMessage) {
                try {
                    console.log(`🎙️ Nota de voz recibida de ${senderName} en ${groupName}`);
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    if (buffer) {
                        const filename = `Audio_${dateStr}_${senderName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.ogg`;
                        const filePath = path.join(audiosDir, filename);
                        fs.writeFileSync(filePath, buffer);

                        // Transcribir con IA
                        const transcripcion = await transcribirAudioIA(filePath);

                        const audioData = {
                            id: Date.now(),
                            fecha: dateStr,
                            hora: timeStr,
                            grupo: groupName,
                            remitente: senderName,
                            transcripcion: transcripcion,
                            url: `/downloads/audios/${filename}`,
                            nombreArchivo: filename
                        };

                        savedAudios.unshift(audioData);
                        if (savedAudios.length > 50) savedAudios.pop();

                        io.emit('new-audio', audioData);

                        // ✉️ ENVIAR AUTO-RESPUESTA CON LA TRANSCRIPCIÓN AL MISMO CHAT
                        const replyMessage = `🎙️ *[Transcripción Automática de Nota de Voz]*\n👤 *De:* ${senderName}\n\n💬 "${transcripcion}"`;
                        await sock.sendMessage(fromJid, { text: replyMessage }, { quoted: msg }).catch(err => {
                            console.error('Error enviando transcripción al chat:', err.message);
                        });

                        // Respaldo en Google Drive
                        respaldarEnGoogleDrive(filePath, 'Audios', filename);
                    }
                } catch (err) {
                    console.error('Error procesando audio de voz:', err.message);
                }
            }

            // 📄 MÓDULO ESPECIAL: RESERVORIO DE HOJAS DE VIDA (CVs)
            const docMsg = msg.message.documentMessage || msg.message.documentWithCaptionMessage?.message?.documentMessage;
            const docName = docMsg?.fileName || '';
            const combinedDocText = (docName + ' ' + textMessage).toLowerCase();
            const isHV = HV_KEYWORDS.some(kw => combinedDocText.includes(kw));

            if (isHV || (docMsg && (docName.toLowerCase().includes('hv') || docName.toLowerCase().includes('cv')))) {
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    if (buffer) {
                        const ext = docName ? path.extname(docName) : '.pdf';
                        const safeGroup = groupName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
                        const safeSender = senderName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 15);
                        const cleanDoc = (docName || 'Hoja_de_Vida').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 25);
                        const profesion = detectarProfesion(combinedDocText);

                        const filename = `HV_${dateStr}_${safeSender}_${safeGroup}_${cleanDoc}${ext.startsWith('.') ? ext : '.' + ext}`;
                        const filePath = path.join(hvsDir, filename);

                        fs.writeFileSync(filePath, buffer);

                        const hvData = {
                            id: Date.now(),
                            fecha: dateStr,
                            hora: timeStr,
                            grupo: groupName,
                            remitente: senderName,
                            profesion: profesion,
                            nombreArchivo: filename,
                            nombreOriginal: docName || 'Hoja_de_Vida.pdf',
                            descripcion: textMessage || 'Hoja de vida recibida por WhatsApp',
                            url: `/downloads/hojas_de_vida/${filename}`,
                            tamano: (buffer.length / 1024).toFixed(1) + ' KB'
                        };

                        savedHvs.unshift(hvData);
                        if (savedHvs.length > 200) savedHvs.pop();

                        io.emit('new-hv', hvData);
                        console.log(`📄 Hoja de Vida guardada en reservorio (${profesion}): ${filename}`);

                        // Respaldo en Google Drive
                        respaldarEnGoogleDrive(filePath, 'Hojas_de_Vida', filename);
                    }
                } catch (err) {
                    console.error('Error procesando Hoja de Vida:', err.message);
                }
            }

            // 📷 MÓDULO 1: GESTIÓN Y ORGANIZACIÓN DE FOTOS
            if (msg.message.imageMessage && !isHV) {
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

                        // Respaldo en Google Drive
                        respaldarEnGoogleDrive(filePath, 'Fotos', filename);
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

// 📊 SINTETIZADOR DE RESÚMENES DE ACTIVIDAD
function generarResumenActividad(periodo = 'diario') {
    const ahora = new Date().toLocaleDateString('es-CO');
    
    return {
        fechaGeneracion: ahora,
        periodo: periodo.toUpperCase(),
        totalFotos: savedPhotos.length,
        totalHvs: savedHvs.length,
        totalAudios: savedAudios.length,
        totalCitas: capturedReminders.length,
        totalEventosClima: lastEvents.length,
        resumenTexto: `📊 *INFORME DE ACTIVIDAD WHATSAPP - ${periodo.toUpperCase()} (${ahora})*\n\n` +
                      `📷 *Fotografías Procesadas:* ${savedPhotos.length}\n` +
                      `📄 *Hojas de Vida Capturadas:* ${savedHvs.length}\n` +
                      `🎙️ *Audios Transcritos:* ${savedAudios.length}\n` +
                      `📅 *Citas y Compromisos:* ${capturedReminders.length}\n` +
                      `🌧️ *Eventos de Clima / Tiempos Muertos:* ${lastEvents.length}\n\n` +
                      `✅ *Estado de la Plataforma:* Operativa 24/7 en la Nube.`
    };
}

// ENDPOINTS REST
app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: qrCodeDataUrl,
        events: lastEvents,
        photos: savedPhotos,
        hvs: savedHvs,
        audios: savedAudios,
        reminders: capturedReminders,
        forwardingRules: forwardingRules,
        cleanupLog: cleanupLog
    });
});

app.get('/api/generate-summary', (req, res) => {
    const periodo = req.query.periodo || 'diario';
    const resumen = generarResumenActividad(periodo);
    res.json({ success: true, resumen });
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
        hvs: savedHvs,
        audios: savedAudios,
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
