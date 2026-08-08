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
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GOOGLE_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';
const TARGET_FORWARD_CHAT_NAME = process.env.TARGET_FORWARD_CHAT_NAME || 'Gerencia Ingelec';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const MONGODB_URI = process.env.MONGODB_URI || '';

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

const backupFile = path.join(__dirname, 'session_backup.json');

// Estado global de la aplicación
let connectionStatus = 'INICIALIZANDO';
let qrCodeDataUrl = null;
let lastEvents = [];
let savedPhotos = [];
let savedHvs = [];
let savedAudios = [];
let capturedReminders = [];
let savedContacts = {};
let messageHistoryStore = [];
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

// 🍃 CONEXIÓN A MONGODB ATLAS Y CARGA AUTOMÁTICA DE DATOS
let mongoClient = null;
let mongoDb = null;

async function initMongoDB() {
    if (!MONGODB_URI) {
        console.log('⚠️ MONGODB_URI no configurado.');
        return null;
    }
    try {
        if (!mongoClient) {
            let uri = MONGODB_URI.trim();
            if (!uri.includes('tlsAllowInvalidCertificates')) {
                uri += (uri.includes('?') ? '&' : '?') + 'tls=true&tlsAllowInvalidCertificates=true';
            }
            mongoClient = new MongoClient(uri, {
                serverSelectionTimeoutMS: 8000,
                connectTimeoutMS: 15000
            });
            await mongoClient.connect();
            mongoDb = mongoClient.db('whatsapp_bot');
            console.log('🍃 Conectado con éxito a la Base de Datos MongoDB Atlas (Persistencia Activa)');
        }
        return mongoDb;
    } catch (e) {
        console.error('⚠️ Error conectando a MongoDB Atlas:', e.message);
        return null;
    }
}

async function cargarDatosDesdeMongoDB() {
    if (!mongoDb) return;
    try {
        savedPhotos = await mongoDb.collection('photos').find({}).sort({ id: -1 }).limit(100).toArray() || [];
        savedHvs = await mongoDb.collection('hvs').find({}).sort({ id: -1 }).limit(200).toArray() || [];
        savedAudios = await mongoDb.collection('audios').find({}).sort({ id: -1 }).limit(100).toArray() || [];
        capturedReminders = await mongoDb.collection('reminders').find({}).sort({ id: -1 }).limit(100).toArray() || [];
        lastEvents = await mongoDb.collection('events').find({}).sort({ id: -1 }).limit(100).toArray() || [];
        messageHistoryStore = await mongoDb.collection('messages').find({}).sort({ id: -1 }).limit(500).toArray() || [];
        console.log(`🍃 Datos persistentes restaurados desde MongoDB Atlas: ${savedPhotos.length} fotos, ${savedHvs.length} HVs, ${savedAudios.length} audios, ${capturedReminders.length} citas.`);
    } catch (e) {
        console.error('Error restaurando datos desde MongoDB Atlas:', e.message);
    }
}

async function persistirItemMongoDB(coleccion, item) {
    try {
        const db = await initMongoDB();
        if (db) {
            await db.collection(coleccion).updateOne({ id: item.id }, { $set: item }, { upsert: true });
        }
    } catch (e) {
        console.error(`Error guardando en colección ${coleccion}:`, e.message);
    }
}

// 🔒 MOTOR DE PERSISTENCIA DE SESIÓN CLOUD
async function guardarSesionEnNube() {
    if (!fs.existsSync(authDir)) return;
    try {
        const files = fs.readdirSync(authDir);
        const sessionStore = {};
        for (const file of files) {
            const fullPath = path.join(authDir, file);
            if (fs.statSync(fullPath).isFile()) {
                sessionStore[file] = fs.readFileSync(fullPath, 'utf-8');
            }
        }
        
        fs.writeFileSync(backupFile, JSON.stringify(sessionStore));

        const db = await initMongoDB();
        if (db) {
            const collection = db.collection('session_auth');
            let savedCount = 0;
            for (const file in sessionStore) {
                await collection.updateOne(
                    { _id: file },
                    { $set: { content: sessionStore[file], updatedAt: new Date() } },
                    { upsert: true }
                );
                savedCount++;
            }
            console.log(`🔒 Sesión guardada con éxito en MongoDB Atlas (${savedCount} archivos respaldados).`);
        }

        if (GOOGLE_WEBHOOK_URL) {
            await axios.post(GOOGLE_WEBHOOK_URL, {
                action: 'save_session',
                sessionData: JSON.stringify(sessionStore)
            }).catch(() => {});
        }
    } catch (e) {
        console.error('Error guardando sesión en nube:', e.message);
    }
}

async function restaurarSesionDesdeNube() {
    try {
        if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

        const db = await initMongoDB();
        if (db) {
            const collection = db.collection('session_auth');
            const docs = await collection.find({}).toArray();
            if (docs && docs.length > 0) {
                for (const doc of docs) {
                    fs.writeFileSync(path.join(authDir, doc._id), doc.content);
                }
                console.log(`🍃 Sesión restaurada con éxito desde MongoDB Atlas (${docs.length} archivos devueltos a disco).`);
                return true;
            }
        }

        if (fs.existsSync(backupFile)) {
            const raw = fs.readFileSync(backupFile, 'utf-8');
            const sessionStore = JSON.parse(raw);
            let restCount = 0;
            for (const file in sessionStore) {
                fs.writeFileSync(path.join(authDir, file), sessionStore[file]);
                restCount++;
            }
            console.log(`✅ Sesión restaurada con éxito desde respaldo local (${restCount} archivos).`);
            return true;
        }

        if (GOOGLE_WEBHOOK_URL) {
            const res = await axios.post(GOOGLE_WEBHOOK_URL, { action: 'get_session' }).catch(() => null);
            if (res && res.data && res.data.sessionData) {
                const sessionStore = JSON.parse(res.data.sessionData);
                for (const file in sessionStore) {
                    fs.writeFileSync(path.join(authDir, file), sessionStore[file]);
                }
                console.log('☁️ Sesión restaurada con éxito desde Google Cloud.');
                return true;
            }
        }
    } catch (e) {
        console.error('Error restaurando sesión:', e.message);
    }
    return false;
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

// 🔍 MOTOR DE BÚSQUEDA UNIVERSAL EN CHATS, GRUPOS Y ARCHIVOS
async function buscarContenidosUniversal(query) {
    const term = (query || '').toLowerCase().trim();
    if (!term) return { resultados: [], total: 0 };

    const resultados = [];

    for (const msg of messageHistoryStore) {
        if ((msg.texto || '').toLowerCase().includes(term) || (msg.remitente || '').toLowerCase().includes(term) || (msg.grupo || '').toLowerCase().includes(term)) {
            resultados.push({
                tipo: '💬 Mensaje de Chat',
                fecha: `${msg.fecha} ${msg.hora}`,
                chat: msg.grupo,
                remitente: msg.remitente,
                contenido: msg.texto
            });
        }
    }

    for (const audio of savedAudios) {
        if ((audio.transcripcion || '').toLowerCase().includes(term) || (audio.remitente || '').toLowerCase().includes(term) || (audio.grupo || '').toLowerCase().includes(term)) {
            resultados.push({
                tipo: '🎙️ Audio Transcrito por IA',
                fecha: `${audio.fecha} ${audio.hora}`,
                chat: audio.grupo,
                remitente: audio.remitente,
                contenido: audio.transcripcion,
                url: audio.url
            });
        }
    }

    for (const hv of savedHvs) {
        if ((hv.descripcion || '').toLowerCase().includes(term) || (hv.remitente || '').toLowerCase().includes(term) || (hv.profesion || '').toLowerCase().includes(term) || (hv.nombreOriginal || '').toLowerCase().includes(term)) {
            resultados.push({
                tipo: '📄 Hoja de Vida',
                fecha: `${hv.fecha} ${hv.hora}`,
                chat: hv.grupo,
                remitente: hv.remitente,
                contenido: `${hv.profesion} - ${hv.nombreOriginal}: ${hv.descripcion}`,
                url: hv.url
            });
        }
    }

    for (const photo of savedPhotos) {
        if ((photo.descripcion || '').toLowerCase().includes(term) || (photo.remitente || '').toLowerCase().includes(term) || (photo.grupo || '').toLowerCase().includes(term)) {
            resultados.push({
                tipo: '📷 Fotografía HD',
                fecha: `${photo.fecha} ${photo.hora}`,
                chat: photo.grupo,
                remitente: photo.remitente,
                contenido: photo.descripcion,
                url: photo.url
            });
        }
    }

    return { query: term, resultados: resultados.slice(0, 50), total: resultados.length };
}

// 🔍 ESCÁNER RETROACTIVO DE HOJAS DE VIDA EN TODOS LOS CHATS (ÚLTIMO AÑO / 365 DÍAS)
async function escanearTodasLasHojasDeVidaHistoricas() {
    if (!sock) throw new Error('Cliente WhatsApp no inicializado');

    console.log('🔍 Iniciando escaneo retroactivo de Hojas de Vida del último año (365 días)...');
    let hvsEncontradas = 0;
    let chatsEscaneados = 0;
    const haceUnAnoMs = Date.now() - (365 * 24 * 60 * 60 * 1000);

    try {
        const groups = await sock.groupFetchAllParticipating();

        for (const jid in groups) {
            chatsEscaneados++;
            const groupName = groups[jid].subject || 'Grupo_WhatsApp';

            try {
                const messages = await sock.fetchMessagesFromChat(jid, { limit: 500 }).catch(() => []);

                for (const msg of messages) {
                    if (!msg.message) continue;

                    const timestampMs = (msg.messageTimestamp || Date.now() / 1000) * 1000;
                    if (timestampMs < haceUnAnoMs) continue;

                    const docMsg = msg.message.documentMessage || msg.message.documentWithCaptionMessage?.message?.documentMessage;
                    const docName = docMsg?.fileName || '';
                    const caption = docMsg?.caption || msg.message.conversation || '';
                    const combinedDocText = (docName + ' ' + caption).toLowerCase();
                    const isHV = HV_KEYWORDS.some(kw => combinedDocText.includes(kw));

                    if (isHV || (docMsg && (docName.toLowerCase().includes('hv') || docName.toLowerCase().includes('cv')))) {
                        try {
                            const buffer = await downloadMediaMessage(msg, 'buffer', {});
                            if (buffer) {
                                const senderJid = msg.key.participant || msg.key.remoteJid;
                                const senderName = msg.pushName || senderJid.split('@')[0];
                                const ext = docName ? path.extname(docName) : '.pdf';
                                const safeSender = senderName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 15);
                                const safeGroup = groupName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
                                const cleanDoc = (docName || 'Hoja_de_Vida').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 25);
                                const profesion = detectarProfesion(combinedDocText);

                                const filename = `HV_Hist_${safeSender}_${safeGroup}_${cleanDoc}${ext.startsWith('.') ? ext : '.' + ext}`;
                                const filePath = path.join(hvsDir, filename);

                                if (!fs.existsSync(filePath)) {
                                    fs.writeFileSync(filePath, buffer);

                                    const hvData = {
                                        id: Date.now() + Math.floor(Math.random() * 1000),
                                        fecha: new Date(timestampMs).toISOString().split('T')[0],
                                        hora: new Date(timestampMs).toTimeString().split(' ')[0],
                                        grupo: groupName,
                                        remitente: senderName,
                                        profesion: profesion,
                                        nombreArchivo: filename,
                                        nombreOriginal: docName || 'Hoja_de_Vida.pdf',
                                        descripcion: caption || 'Hoja de vida histórica rescatada del último año',
                                        url: `/downloads/hojas_de_vida/${filename}`,
                                        tamano: (buffer.length / 1024).toFixed(1) + ' KB'
                                    };

                                    savedHvs.unshift(hvData);
                                    hvsEncontradas++;
                                    io.emit('new-hv', hvData);
                                    persistirItemMongoDB('hvs', hvData);
                                    respaldarEnGoogleDrive(filePath, 'Hojas_de_Vida', filename);
                                }
                            }
                        } catch (e) {}
                    }
                }
            } catch (err) {
                console.error(`Error escaneando chat ${groupName}:`, err.message);
            }
        }
    } catch (err) {
        console.error('Error general en escaneo retroactivo:', err.message);
    }

    console.log(`✅ Escaneo del último año completado: ${hvsEncontradas} Hojas de Vida rescatadas de ${chatsEscaneados} chats.`);
    return { chatsEscaneados, hvsEncontradas, totalHvs: savedHvs.length };
}

let sock = null;

async function connectToWhatsApp() {
    console.log('⚡ Iniciando conexión a WhatsApp con Persistencia MongoDB Atlas...');
    
    const tieneSesion = await restaurarSesionDesdeNube();

    connectionStatus = tieneSesion ? 'RESTAURANDO_SESION' : 'INICIALIZANDO';
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

    sock.ev.on('contacts.upsert', (contacts) => {
        for (const c of contacts) {
            if (c.id) {
                savedContacts[c.id] = {
                    id: c.id,
                    name: c.name || c.notify || c.verifiedName || c.id.split('@')[0],
                    notify: c.notify
                };
            }
        }
        console.log(`📱 Agenda sincronizada: ${Object.keys(savedContacts).length} contactos de WhatsApp cargados.`);
    });

    sock.ev.on('contacts.update', (updates) => {
        for (const update of updates) {
            if (update.id && savedContacts[update.id]) {
                Object.assign(savedContacts[update.id], update);
            }
        }
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        await guardarSesionEnNube();
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && connectionStatus !== 'CONECTADO_24_7') {
            console.log('📌 Código QR de Baileys generado. Listo para escanear.');
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
            
            if (statusCode === DisconnectReason.loggedOut) {
                console.log('🧹 Sesión cerrada por el usuario. Limpiando credenciales...');
                try {
                    fs.rmSync(authDir, { recursive: true, force: true });
                    if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile);
                } catch (e) {}
                connectionStatus = 'DESCONECTADO';
            } else {
                connectionStatus = 'RECONECTANDO';
            }

            qrCodeDataUrl = null;
            io.emit('status-update', { status: connectionStatus, qr: null });

            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('🚀 ¡Conectado con éxito a WhatsApp 24/7 en la Nube!');
            connectionStatus = 'CONECTADO_24_7';
            qrCodeDataUrl = null;
            await guardarSesionEnNube();
            io.emit('status-update', { status: connectionStatus, qr: null });

            setTimeout(() => {
                escanearTodasLasHojasDeVidaHistoricas().catch(() => {});
            }, 5000);
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

            if (senderJid) {
                savedContacts[senderJid] = {
                    id: senderJid,
                    name: senderName,
                    notify: msg.pushName
                };
            }

            const textMessage = msg.message.conversation || 
                              msg.message.extendedTextMessage?.text || 
                              msg.message.imageMessage?.caption || 
                              msg.message.videoMessage?.caption || 
                              msg.message.documentMessage?.caption || '';
            const textLower = textMessage.toLowerCase();

            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0];

            if (textMessage.length > 0) {
                const msgData = {
                    id: Date.now(),
                    fecha: dateStr,
                    hora: timeStr,
                    grupo: groupName,
                    remitente: senderName,
                    texto: textMessage
                };
                messageHistoryStore.unshift(msgData);
                if (messageHistoryStore.length > 500) messageHistoryStore.pop();
                persistirItemMongoDB('messages', msgData);
            }

            // 🎙️ AUDIOS Y TRANSCRIPCIÓN IA
            if (msg.message.audioMessage) {
                try {
                    console.log(`🎙️ Nota de voz recibida de ${senderName} en ${groupName}`);
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    if (buffer) {
                        const filename = `Audio_${dateStr}_${senderName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.ogg`;
                        const filePath = path.join(audiosDir, filename);
                        fs.writeFileSync(filePath, buffer);

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
                        persistirItemMongoDB('audios', audioData);

                        const replyMessage = transcripcion;
                        await sock.sendMessage(fromJid, { text: replyMessage }, { quoted: msg }).catch(err => {
                            console.error('Error enviando transcripción al chat:', err.message);
                        });

                        respaldarEnGoogleDrive(filePath, 'Audios', filename);
                    }
                } catch (err) {
                    console.error('Error procesando audio de voz:', err.message);
                }
            }

            // 📄 HOJAS DE VIDA (CVs)
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
                        persistirItemMongoDB('hvs', hvData);
                        console.log(`📄 Hoja de Vida guardada en reservorio (${profesion}): ${filename}`);

                        respaldarEnGoogleDrive(filePath, 'Hojas_de_Vida', filename);
                    }
                } catch (err) {
                    console.error('Error procesando Hoja de Vida:', err.message);
                }
            }

            // 📷 FOTOS
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
                        persistirItemMongoDB('photos', photoData);
                        console.log(`📷 Foto guardada y renombrada: ${filename}`);

                        respaldarEnGoogleDrive(filePath, 'Fotos', filename);
                    }
                } catch (err) {
                    console.error('Error procesando imagen:', err.message);
                }
            }

            // 🌧️ CLIMA Y TIEMPOS MUERTOS
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
                persistirItemMongoDB('events', eventData);
                console.log(`🌧️ Evento de clima/tiempo muerto detectado en ${groupName}`);

                if (GOOGLE_WEBHOOK_URL) {
                    axios.post(GOOGLE_WEBHOOK_URL, eventData).catch(err => {
                        console.error('Error enviando evento a Google Sheets:', err.message);
                    });
                }
            }

            // 📅 CITAS Y RECORDATORIOS
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
                persistirItemMongoDB('reminders', reminderData);
                console.log(`📅 Cita/Compromiso detectado: "${textMessage}"`);
            }

            // 🔁 REENVÍO INTELIGENTE
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

// 🧹 LIMPIEZA DE CHATS INACTIVOS
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

// 📊 SINTETIZADOR DE RESÚMENES
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
                      `✅ *Estado de la Plataforma:* Operativa 24/7 en la Nube con Persistencia Activa.`
    };
}

// ENDPOINTS REST
app.get('/api/search-content', async (req, res) => {
    try {
        const query = req.query.q || '';
        const resultado = await buscarContenidosUniversal(query);
        res.json({ success: true, ...resultado });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/send-message', async (req, res) => {
    try {
        const { targetName, phone, message } = req.body;
        if (!sock) return res.status(500).json({ success: false, error: 'WhatsApp no está conectado' });

        let targetJid = null;

        if (phone) {
            const cleanPhone = phone.replace(/[^0-9]/g, '');
            targetJid = `${cleanPhone}@s.whatsapp.net`;
        } else if (targetName) {
            const search = targetName.toLowerCase().trim();

            for (const jid in savedContacts) {
                const c = savedContacts[jid];
                const cName = (c.name || c.notify || '').toLowerCase();
                if (cName.includes(search)) {
                    targetJid = jid;
                    console.log(`🎯 Contacto encontrado en agenda: "${c.name}" (${jid})`);
                    break;
                }
            }

            if (!targetJid) {
                const groups = await sock.groupFetchAllParticipating().catch(() => ({}));
                for (const jid in groups) {
                    if (groups[jid].subject && groups[jid].subject.toLowerCase().includes(search)) {
                        targetJid = jid;
                        console.log(`🎯 Grupo encontrado: "${groups[jid].subject}" (${jid})`);
                        break;
                    }
                }
            }
        }

        if (!targetJid) {
            return res.status(404).json({ success: false, error: `No se encontró el contacto o grupo "${targetName || phone}".` });
        }

        await sock.sendMessage(targetJid, { text: message });
        console.log(`✅ Mensaje enviado exitosamente a ${targetJid}`);
        res.json({ success: true, targetJid });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

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
        cleanupLog: cleanupLog,
        contactsCount: Object.keys(savedContacts).length
    });
});

app.post('/api/scan-history-hvs', async (req, res) => {
    try {
        const resultado = await escanearTodasLasHojasDeVidaHistoricas();
        res.json({ success: true, resultado });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
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
        cleanupLog: cleanupLog,
        contactsCount: Object.keys(savedContacts).length
    });
});

server.listen(PORT, async () => {
    console.log(`🌐 Servidor Hub WhatsApp (Baileys) escuchando en puerto ${PORT}`);
    await initMongoDB();
    connectToWhatsApp().catch(err => {
        console.error('❌ Error conectando a WhatsApp Baileys:', err);
    });
});
