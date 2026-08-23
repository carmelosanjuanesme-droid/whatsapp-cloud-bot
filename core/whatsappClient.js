const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    makeCacheableSignalKeyStore,
    DisconnectReason, 
    downloadMediaMessage,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');

const { dbState, initMongoDB, persistirItemMongoDB, registrarLogConexion } = require('../config/database');
const { cargarAuthDirDesdeMongoDB, sincronizarAuthDirConMongoDB } = require('./authVault');
const { transcribirAudioIA } = require('../services/groqService');
const { respaldarEnGoogleDrive } = require('../services/driveService');
const { procesarComandoIAEntrante } = require('../services/aiAgentService');

const authDir = path.join(__dirname, '..', 'baileys_auth_info');
const downloadsDir = path.join(__dirname, '..', 'public', 'downloads');

const photosDir = path.join(downloadsDir, 'photos');
const hvsDir = path.join(downloadsDir, 'hojas_de_vida');
const audiosDir = path.join(downloadsDir, 'audios');

[photosDir, hvsDir, audiosDir, authDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

let sock = null;
let ioInstance = null;

function setSocketIO(io) {
    ioInstance = io;
}

function getSockInstance() {
    return sock;
}

const CALENDAR_KEYWORDS = ['reunión', 'cita', 'compromiso', 'agenda', 'agendar', 'entrevista', 'visita', 'reunion', 'pago', 'entrega', 'plazo', 'mañana a las', 'hoy a las'];

function extraerTextoDelMensaje(msg) {
    if (!msg || !msg.message) return '';
    return msg.message.conversation ||
           msg.message.extendedTextMessage?.text ||
           msg.message.imageMessage?.caption ||
           msg.message.videoMessage?.caption ||
           msg.message.documentMessage?.caption || '';
}

function clasificarProfesiOnHV(texto, filename) {
    const content = (texto + ' ' + filename).toLowerCase();
    if (content.includes('ingenier') || content.includes('eléctric') || content.includes('electrónic') || content.includes('obras')) return '👷‍♂️ Ingeniería & Obras';
    if (content.includes('contador') || content.includes('financier') || content.includes('administrad') || content.includes('auxiliar')) return '📊 Administración & Finanzas';
    if (content.includes('desarrollad') || content.includes('programad') || content.includes('sistemas') || content.includes('software')) return '💻 TI & Sistemas';
    if (content.includes('técnic') || content.includes('tecnólog') || content.includes('mantenimiento') || content.includes('operario')) return '🔧 Técnico & Operativo';
    if (content.includes('comercial') || content.includes('ventas') || content.includes('asesor') || content.includes('marketing')) return '📈 Ventas & Comercial';
    return '📋 General';
}

async function procesarMensajeEntrante(msg, isHistory = false) {
    if (!msg.message) return;

    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const senderJid = msg.key.participant || msg.key.remoteJid;

    let senderName = msg.pushName || senderJid.split('@')[0];
    if (dbState.savedContacts[senderJid] && dbState.savedContacts[senderJid].name) {
        senderName = dbState.savedContacts[senderJid].name;
    }

    let groupName = isGroup ? 'Grupo WhatsApp' : 'Chat Privado';
    if (isGroup && sock) {
        try {
            const groupMetadata = await sock.groupMetadata(jid);
            if (groupMetadata && groupMetadata.subject) groupName = groupMetadata.subject;
        } catch (e) {}
    }

    const textMessage = extraerTextoDelMensaje(msg);
    const ahora = new Date();
    const dateStr = ahora.toLocaleDateString('es-CO');
    const timeStr = ahora.toLocaleTimeString('es-CO');

    // 🤖 COMANDOS DE IA
    if (textMessage.match(/^!(ia|bot|asistente)/i)) {
        console.log(`🤖 Comando IA detectado de ${senderName} en ${groupName}: "${textMessage}"`);
        await procesarComandoIAEntrante(jid, textMessage, senderName, groupName, getSockInstance);
    }

    // 📅 DETECCIÓN DE CITAS Y COMPROMISOS
    const lowerText = textMessage.toLowerCase();
    if (CALENDAR_KEYWORDS.some(kw => lowerText.includes(kw))) {
        const reminderData = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            fechaDetec: `${dateStr} ${timeStr}`,
            origen: groupName,
            remitente: senderName,
            mensaje: textMessage
        };
        dbState.capturedReminders.unshift(reminderData);
        if (dbState.capturedReminders.length > 50) dbState.capturedReminders.pop();
        if (ioInstance) ioInstance.emit('new-reminder', reminderData);
        persistirItemMongoDB('reminders', reminderData);
    }

    // 📄 HOJAS DE VIDA (DOC, DOCX, PDF)
    const docMsg = msg.message.documentMessage || msg.message.documentWithCaptionMessage?.message?.documentMessage;
    if (docMsg) {
        const filename = docMsg.fileName || 'documento.pdf';
        const ext = path.extname(filename).toLowerCase();
        if (['.pdf', '.doc', '.docx'].includes(ext)) {
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                if (buffer) {
                    const safeGroup = groupName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
                    const safeSender = senderName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 15);
                    const fileId = `${Date.now()}_${safeSender}_HV_${filename}`;
                    const filePath = path.join(hvsDir, fileId);
                    fs.writeFileSync(filePath, buffer);

                    let extractedText = '';
                    if (ext === '.docx') {
                        try {
                            const result = await mammoth.extractRawText({ buffer });
                            extractedText = result.value || '';
                        } catch (e) {}
                    }

                    const profesion = clasificarProfesiOnHV(extractedText + ' ' + textMessage, filename);
                    const hvData = {
                        id: Date.now() + Math.floor(Math.random() * 1000),
                        fecha: dateStr,
                        hora: timeStr,
                        grupo: groupName,
                        remitente: senderName,
                        nombreOriginal: filename,
                        tamano: `${(buffer.length / 1024 / 1024).toFixed(2)} MB`,
                        descripcion: textMessage || extractedText.substring(0, 100) || 'Hoja de Vida Adjunta',
                        profesion: profesion,
                        url: `/downloads/hojas_de_vida/${fileId}`,
                        nombreArchivo: fileId
                    };

                    dbState.savedHvs.unshift(hvData);
                    if (dbState.savedHvs.length > 100) dbState.savedHvs.pop();

                    if (ioInstance) ioInstance.emit('new-hv', hvData);
                    persistirItemMongoDB('hojas_de_vida', hvData);
                    console.log(`📄 Hoja de Vida guardada (${profesion}): ${fileId}`);
                    respaldarEnGoogleDrive(filePath, 'Hojas_de_Vida', fileId);
                }
            } catch (err) {
                console.error('Error procesando Hoja de Vida:', err.message);
            }
        }
    }

    // 🎙️ AUDIOS Y NOTAS DE VOZ
    if (msg.message.audioMessage) {
        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            if (buffer) {
                const safeSender = senderName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 15);
                const filename = `${Date.now()}_${safeSender}_Audio.ogg`;
                const filePath = path.join(audiosDir, filename);
                fs.writeFileSync(filePath, buffer);

                console.log(`🎙️ Nota de voz descargada: ${filename}. Iniciando transcripción Groq Whisper...`);
                const transcripcion = await transcribirAudioIA(filePath);

                const audioData = {
                    id: Date.now() + Math.floor(Math.random() * 1000),
                    fecha: dateStr,
                    hora: timeStr,
                    grupo: groupName,
                    remitente: senderName,
                    transcripcion: transcripcion,
                    url: `/downloads/audios/${filename}`,
                    nombreArchivo: filename
                };

                dbState.savedAudios.unshift(audioData);
                if (dbState.savedAudios.length > 50) dbState.savedAudios.pop();

                if (ioInstance) ioInstance.emit('new-audio', audioData);
                persistirItemMongoDB('audios', audioData);
                respaldarEnGoogleDrive(filePath, 'Audios', filename);
            }
        } catch (err) {
            console.error('Error procesando audio de voz:', err.message);
        }
    }

    // 📷 FOTOS HD
    if (msg.message.imageMessage && !docMsg) {
        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            if (buffer) {
                const safeSender = senderName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 15);
                const filename = `${Date.now()}_${safeSender}_Foto.jpg`;
                const filePath = path.join(photosDir, filename);
                fs.writeFileSync(filePath, buffer);

                const photoData = {
                    id: Date.now() + Math.floor(Math.random() * 1000),
                    fecha: dateStr,
                    hora: timeStr,
                    grupo: groupName,
                    remitente: senderName,
                    descripcion: textMessage || 'Sin descripción',
                    url: `/downloads/photos/${filename}`,
                    nombreArchivo: filename
                };

                dbState.savedPhotos.unshift(photoData);
                if (dbState.savedPhotos.length > 50) dbState.savedPhotos.pop();

                if (ioInstance) ioInstance.emit('new-photo', photoData);
                persistirItemMongoDB('photos', photoData);
                respaldarEnGoogleDrive(filePath, 'Fotos', filename);
            }
        } catch (err) {
            console.error('Error procesando imagen:', err.message);
        }
    }
}

async function connectToWhatsApp() {
    console.log('⚡ Iniciando conexión a WhatsApp con Persistencia Oficial MultiFile + Espejo MongoDB Atlas...');
    
    if (sock) {
        try {
            sock.ev.removeAllListeners();
            sock.ws?.close();
        } catch (e) {}
        sock = null;
    }

    const db = await initMongoDB();
    if (db) {
        await cargarAuthDirDesdeMongoDB(db, authDir);
    }

    const authState = await useMultiFileAuthState(authDir);
    const { state, saveCreds } = authState;

    const credsFile = path.join(authDir, 'creds.json');
    const isSessionRegistered = fs.existsSync(credsFile) && Boolean(state?.creds?.registered || state?.creds?.me?.id || state?.creds?.me);

    dbState.connectionStatus = isSessionRegistered ? 'RESTAURANDO_SESION' : 'ESPERANDO_QR';
    if (ioInstance) ioInstance.emit('status-update', { status: dbState.connectionStatus, qr: isSessionRegistered ? null : dbState.qrCodeDataUrl });

    const socketOptions = {
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 30000,
        keepAliveIntervalMs: 15000
    };

    sock = makeWASocket(socketOptions);

    sock.ev.on('contacts.upsert', (contacts) => {
        for (const c of contacts) {
            if (c.id) {
                dbState.savedContacts[c.id] = {
                    id: c.id,
                    name: c.name || c.notify || c.verifiedName || c.id.split('@')[0],
                    notify: c.notify
                };
            }
        }
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        if (db) {
            await sincronizarAuthDirConMongoDB(db, authDir);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify') {
            for (const msg of messages) {
                if (msg && msg.message) {
                    await procesarMensajeEntrante(msg, false);
                }
            }
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const isRegistered = fs.existsSync(credsFile) && Boolean(state?.creds?.registered || state?.creds?.me?.id || state?.creds?.me);

        if (qr && !isRegistered) {
            console.log('📌 Código QR generado. Listo para escanear.');
            dbState.connectionStatus = 'ESPERANDO_QR';
            try {
                dbState.qrCodeDataUrl = await qrcode.toDataURL(qr);
                if (ioInstance) ioInstance.emit('status-update', { status: dbState.connectionStatus, qr: dbState.qrCodeDataUrl });
                registrarLogConexion('ESPERANDO_QR', 'Código QR generado y listo para escaneo');
            } catch (err) {
                console.error('Error convirtiendo QR a DataURL:', err);
            }
        } else if (qr && isRegistered) {
            console.log('🔄 Ignorando QR temporal: La sesión ya está registrada en MongoDB Atlas. Restaurando automáticamente...');
            dbState.connectionStatus = 'RESTAURANDO_SESION';
            if (ioInstance) ioInstance.emit('status-update', { status: dbState.connectionStatus, qr: null });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isExplicitLogout = statusCode === DisconnectReason.loggedOut;

            console.log(`⚠️ Conexión de WhatsApp cerrada. Código: ${statusCode}. LoggedOut: ${isExplicitLogout}. Registered: ${isRegistered}`);

            if (isExplicitLogout && !isRegistered) {
                console.log('🧹 Sesión desvinculada explícitamente por WhatsApp. Limpiando credenciales en MongoDB Atlas...');
                try {
                    fs.rmSync(authDir, { recursive: true, force: true });
                    if (db) {
                        await db.collection('baileys_atomic_auth').deleteMany({});
                    }
                } catch (e) {}
                dbState.connectionStatus = 'ESPERANDO_QR';
                dbState.qrCodeDataUrl = null;
                if (ioInstance) ioInstance.emit('status-update', { status: dbState.connectionStatus, qr: null });
                registrarLogConexion('DESCONECTADO', 'Sesión desvinculada por WhatsApp. Credenciales reseteadas.');
                setTimeout(connectToWhatsApp, 3000);
            } else {
                console.log('🔄 Reabriendo socket de WhatsApp automáticamente (Preservando MongoDB Atlas)...');
                dbState.connectionStatus = isRegistered ? 'CONECTADO_24_7' : 'INICIALIZANDO';
                if (ioInstance) ioInstance.emit('status-update', { status: dbState.connectionStatus, qr: isRegistered ? null : dbState.qrCodeDataUrl });
                registrarLogConexion('RECONECTANDO', `Reconexión automática de socket (Código HTTP ${statusCode || 'Socket Switch'})`);
                setTimeout(connectToWhatsApp, 2000);
            }
        } else if (connection === 'open') {
            console.log('🚀 ¡Conectado con éxito a WhatsApp 24/7 en la Nube!');
            dbState.connectionStatus = 'CONECTADO_24_7';
            dbState.qrCodeDataUrl = null;
            await saveCreds();
            if (db) {
                await sincronizarAuthDirConMongoDB(db, authDir);
            }
            if (ioInstance) ioInstance.emit('status-update', { status: dbState.connectionStatus, qr: null });
            registrarLogConexion('CONECTADO_24_7', `🟢 Sesión 24/7 activa para +${sock?.user?.id?.split('@')[0] || 'Ingelec'} y respaldada en MongoDB Atlas`);
        }
    });
}

module.exports = {
    setSocketIO,
    getSockInstance,
    connectToWhatsApp,
    procesarMensajeEntrante
};
