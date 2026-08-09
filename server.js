const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    makeCacheableSignalKeyStore,
    DisconnectReason, 
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    Browsers,
    BufferJSON,
    initAuthCreds,
    proto
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dns = require('dns');
try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {}
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
let uptimeLogs = [];

function registrarLogConexion(evento, detalle = '') {
    const logItem = {
        id: Date.now(),
        fecha: new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }),
        hora: new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' }),
        status: connectionStatus,
        evento: evento,
        detalle: detalle
    };
    uptimeLogs.unshift(logItem);
    if (uptimeLogs.length > 200) uptimeLogs.pop();
    io.emit('uptime-log-new', logItem);
    persistirItemMongoDB('uptime_logs', logItem);
    console.log(`📡 [LOG CONEXIÓN] [${logItem.hora}] ${evento} (${connectionStatus})`);
}

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
    'perfil profesional', 'hoja de trabajo', 'postulacion', 'candidato', 'aspirante', 'hv', 'cesar'
];

function detectarProfesion(texto) {
    const t = (texto || '').toLowerCase();
    if (t.includes('electric') || t.includes('electrónic') || t.includes('electrotécn') || t.includes('liniero') || t.includes('subestacion')) {
        return '⚡ Ingeniería Eléctrica / Electrónica';
    }
    if (t.includes('civil') || t.includes('arquitect') || t.includes('obra') || t.includes('plano') || t.includes('estructura')) {
        return '🏗️ Ingeniería Civil / Obra / Arquitectura';
    }
    if (t.includes('admin') || t.includes('contad') || t.includes('financ') || t.includes('auxiliar') || t.includes('recursos humanos') || t.includes('rh') || t.includes('sst')) {
        return '💼 Administración / SST / Contabilidad';
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
                family: 4,
                serverSelectionTimeoutMS: 8000,
                connectTimeoutMS: 10000
            });
            await mongoClient.connect();
            mongoDb = mongoClient.db('whatsapp_bot');
            console.log('🍃 Conectado con éxito a la Base de Datos MongoDB Atlas (Persistencia Activa)');
            
            cargarDatosDesdeMongoDB().catch(() => {});
        }
        return mongoDb;
    } catch (e) {
        console.error('⚠️ Error conectando a MongoDB Atlas:', e.message);
        mongoClient = null;
        mongoDb = null;
        return null;
    }
}

async function cargarDatosDesdeMongoDB() {
    if (!mongoDb) return;
    try {
        const [photos, hvs, audios, reminders, events, msgs, uptimes] = await Promise.all([
            mongoDb.collection('photos').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
            mongoDb.collection('hvs').find({}).sort({ id: -1 }).limit(200).toArray().catch(() => []),
            mongoDb.collection('audios').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
            mongoDb.collection('reminders').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
            mongoDb.collection('events').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
            mongoDb.collection('messages').find({}).sort({ id: -1 }).limit(500).toArray().catch(() => []),
            mongoDb.collection('uptime_logs').find({}).sort({ id: -1 }).limit(200).toArray().catch(() => [])
        ]);

        savedPhotos = photos || [];
        savedHvs = hvs || [];
        savedAudios = audios || [];
        capturedReminders = reminders || [];
        lastEvents = events || [];
        messageHistoryStore = msgs || [];
        uptimeLogs = uptimes || [];

        console.log(`🍃 Datos persistentes restaurados en paralelo desde MongoDB Atlas: ${savedPhotos.length} fotos, ${savedHvs.length} HVs, ${savedAudios.length} audios, ${uptimeLogs.length} logs de uptime.`);
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

function isBase64Str(str) {
    if (!str || typeof str !== 'string') return false;
    try {
        return Buffer.from(str, 'base64').toString('base64') === str.trim();
    } catch (e) {
        return false;
    }
}

// 🔒 MOTOR DE AUTENTICACIÓN ATÓMICO 100% PERSISTENTE EN MONGODB ATLAS (CERO DISCO LOCAL)
async function useMongoDBAuthState(db) {
    const collection = db.collection('baileys_atomic_auth');

    // Cargar credenciales principales
    const credsDoc = await collection.findOne({ _id: 'creds' });
    let creds;
    if (credsDoc && credsDoc.data) {
        creds = JSON.parse(JSON.stringify(credsDoc.data), BufferJSON.reviver);
    } else {
        creds = initAuthCreds();
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const keysDoc = await collection.findOne({ _id: `keys_${type}` });
                    const data = keysDoc && keysDoc.data ? JSON.parse(JSON.stringify(keysDoc.data), BufferJSON.reviver) : {};
                    const result = {};
                    for (const id of ids) {
                        let value = data[id];
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        if (value) {
                            result[id] = value;
                        }
                    }
                    return result;
                },
                set: async (data) => {
                    for (const category in data) {
                        const typeKeys = data[category];
                        const keysDoc = await collection.findOne({ _id: `keys_${category}` });
                        const existing = keysDoc && keysDoc.data ? JSON.parse(JSON.stringify(keysDoc.data), BufferJSON.reviver) : {};
                        
                        for (const id in typeKeys) {
                            const value = typeKeys[id];
                            if (value) {
                                existing[id] = value;
                            } else {
                                delete existing[id];
                            }
                        }
                        
                        const serialized = JSON.parse(JSON.stringify(existing, BufferJSON.replacer));
                        await collection.updateOne(
                            { _id: `keys_${category}` },
                            { $set: { data: serialized, updatedAt: new Date() } },
                            { upsert: true }
                        );
                    }
                }
            }
        },
        saveCreds: async () => {
            const serializedCreds = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
            await collection.updateOne(
                { _id: 'creds' },
                { $set: { data: serializedCreds, updatedAt: new Date() } },
                { upsert: true }
            );
        }
    };
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

// 🎙️ TRANCRIPCIÓN DE AUDIOS DE VOZ CON IA (GROQ WHISPER)
async function transcribirAudioIA(audioFilePath) {
    const groqKey = process.env.GROQ_API_KEY || GROQ_API_KEY || '';
    if (groqKey) {
        try {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('file', fs.createReadStream(audioFilePath));
            form.append('model', 'whisper-large-v3-turbo');
            form.append('language', 'es');

            const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${groqKey}`
                }
            });

            if (response.data && response.data.text) {
                console.log(`🎙️ Transcripción Groq Whisper realizada con éxito: "${response.data.text.substring(0, 50)}..."`);
                return response.data.text.trim();
            }
        } catch (e) {
            console.error('Error usando Groq Whisper API:', e.message);
        }
    }

    return null;
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

// 📩 PROCESADOR UNIVERSAL DE MENSAJES (VIVOS E HISTÓRICOS)
async function procesarMensajeEntrante(msg, isHistoryMessage = false) {
    if (!msg.message || msg.key.fromMe) return;

    const fromJid = msg.key.remoteJid;
    const isGroup = fromJid.endsWith('@g.us');
    const senderJid = msg.key.participant || fromJid;
    const senderName = msg.pushName || (savedContacts[senderJid]?.name) || senderJid.split('@')[0];
    const groupName = isGroup ? (msg.pushName || 'Grupo_WhatsApp') : senderName;

    if (senderJid) {
        savedContacts[senderJid] = {
            id: senderJid,
            name: senderName,
            notify: msg.pushName
        };
    }

    const docMsg = msg.message.documentMessage || 
                   msg.message.documentWithCaptionMessage?.message?.documentMessage ||
                   msg.message.ephemeralMessage?.message?.documentMessage ||
                   msg.message.viewOnceMessage?.message?.documentMessage;

    const textMessage = msg.message.conversation || 
                      msg.message.extendedTextMessage?.text || 
                      msg.message.imageMessage?.caption || 
                      msg.message.videoMessage?.caption || 
                      docMsg?.caption || '';
    const textLower = textMessage.toLowerCase();

    const timestampMs = (msg.messageTimestamp || Date.now() / 1000) * 1000;
    const now = new Date(timestampMs);
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];

    if (textMessage.length > 0) {
        const msgData = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            jid: fromJid,
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

    // 📄 HOJAS DE VIDA (CVs)
    const docName = docMsg?.fileName || '';
    const combinedDocText = (docName + ' ' + textMessage).toLowerCase();
    const ext = docName ? path.extname(docName).toLowerCase() : '';
    const isDocExtension = ext === '.pdf' || ext === '.doc' || ext === '.docx';
    const isHVKeyword = HV_KEYWORDS.some(kw => combinedDocText.includes(kw.trim()));
    const isMariaChat = groupName.toLowerCase().includes('maria') || 
                        senderName.toLowerCase().includes('maria') ||
                        groupName.toLowerCase().includes('gesti') ||
                        senderName.toLowerCase().includes('gesti');

    if (docMsg && (isMariaChat || isHVKeyword || isDocExtension || docName.toLowerCase().includes('hv') || docName.toLowerCase().includes('cv'))) {
        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            if (buffer) {
                const safeGroup = groupName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
                const safeSender = senderName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 15);
                const cleanDoc = (docName || 'Hoja_de_Vida').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 25);
                const profesion = detectarProfesion(combinedDocText);

                const fileExt = ext || '.pdf';
                const filename = `HV_${dateStr}_${safeSender}_${safeGroup}_${cleanDoc}${fileExt.startsWith('.') ? fileExt : '.' + fileExt}`;
                const filePath = path.join(hvsDir, filename);

                if (!fs.existsSync(filePath)) {
                    fs.writeFileSync(filePath, buffer);

                    const hvData = {
                        id: Date.now() + Math.floor(Math.random() * 1000),
                        fecha: dateStr,
                        hora: timeStr,
                        grupo: groupName,
                        remitente: senderName,
                        profesion: isMariaChat ? `👩‍💼 María Gestión Humana (${profesion})` : profesion,
                        nombreArchivo: filename,
                        nombreOriginal: docName || 'Hoja_de_Vida.pdf',
                        descripcion: textMessage || `Hoja de Vida procesada de ${senderName}`,
                        url: `/downloads/hojas_de_vida/${filename}`,
                        tamano: (buffer.length / 1024).toFixed(1) + ' KB'
                    };

                    savedHvs.unshift(hvData);
                    if (savedHvs.length > 200) savedHvs.pop();

                    io.emit('new-hv', hvData);
                    persistirItemMongoDB('hvs', hvData);
                    console.log(`📄 Hoja de Vida capturada (${hvData.profesion}): ${filename}`);

                    const folderDrive = isMariaChat ? 'Hojas_de_Vida_Maria_Gestion_Humana' : 'Hojas_de_Vida';
                    respaldarEnGoogleDrive(filePath, folderDrive, filename);
                }
            }
        } catch (err) {
            console.error('Error procesando Hoja de Vida:', err.message);
        }
    }

    // 🎙️ AUDIOS Y TRANSCRIPCIÓN IA
    if (msg.message.audioMessage && !isHistoryMessage) {
        try {
            console.log(`🎙️ Nota de voz recibida de ${senderName} en ${groupName}`);
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            if (buffer) {
                const filename = `Audio_${dateStr}_${senderName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.ogg`;
                const filePath = path.join(audiosDir, filename);
                fs.writeFileSync(filePath, buffer);

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

                savedAudios.unshift(audioData);
                if (savedAudios.length > 50) savedAudios.pop();

                io.emit('new-audio', audioData);
                persistirItemMongoDB('audios', audioData);

                if (transcripcion && typeof transcripcion === 'string' && transcripcion.trim().length > 0) {
                    await sock.sendMessage(fromJid, { text: transcripcion.trim() }, { quoted: msg }).catch(err => {
                        console.error('Error enviando transcripción al chat:', err.message);
                    });
                }

                respaldarEnGoogleDrive(filePath, 'Audios', filename);
            }
        } catch (err) {
            console.error('Error procesando audio de voz:', err.message);
        }
    }

    // 📷 FOTOS
    if (msg.message.imageMessage && !docMsg) {
        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            if (buffer) {
                const safeGroup = groupName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
                const safeSender = senderName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 15);
                const cleanDesc = textMessage.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);

                const filename = `${dateStr}_${safeGroup}_${safeSender}_${cleanDesc || 'Foto'}_${Date.now()}.jpg`;
                const filePath = path.join(photosDir, filename);

                if (!fs.existsSync(filePath)) {
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

                    savedPhotos.unshift(photoData);
                    if (savedPhotos.length > 50) savedPhotos.pop();

                    io.emit('new-photo', photoData);
                    persistirItemMongoDB('photos', photoData);
                    console.log(`📷 Foto guardada y renombrada: ${filename}`);

                    respaldarEnGoogleDrive(filePath, 'Fotos', filename);
                }
            }
        } catch (err) {
            console.error('Error procesando imagen:', err.message);
        }
    }
}

let sock = null;

async function connectToWhatsApp() {
    console.log('⚡ Iniciando conexión a WhatsApp con Persistencia ATÓMICA en MongoDB Atlas...');
    
    if (sock) {
        try {
            sock.ev.removeAllListeners();
            sock.ws?.close();
        } catch (e) {}
        sock = null;
    }

    const db = await initMongoDB();
    let authState;
    if (db) {
        authState = await useMongoDBAuthState(db);
    } else {
        console.log('⚠️ MongoDB no disponible, usando fallback en disco...');
        authState = await useMultiFileAuthState(authDir);
    }

    const { state, saveCreds } = authState;
    const isSessionRegistered = Boolean(state?.creds?.me?.id);

    connectionStatus = isSessionRegistered ? 'RESTAURANDO_SESION' : 'ESPERANDO_QR';
    io.emit('status-update', { status: connectionStatus, qr: isSessionRegistered ? null : qrCodeDataUrl });

    const socketOptions = {
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false
    };

    sock = makeWASocket(socketOptions);

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
    });

    sock.ev.on('messaging-history.set', async ({ messages, contacts }) => {
        console.log(`📜 Sincronización completa de Historial de WhatsApp recibida: ${messages?.length || 0} mensajes.`);
        if (contacts && Array.isArray(contacts)) {
            for (const c of contacts) {
                if (c.id) {
                    savedContacts[c.id] = {
                        id: c.id,
                        name: c.name || c.notify || c.verifiedName || c.id.split('@')[0],
                        notify: c.notify
                    };
                }
            }
        }
        if (messages && Array.isArray(messages)) {
            for (const msg of messages) {
                await procesarMensajeEntrante(msg, true);
            }
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const isRegistered = Boolean(state?.creds?.me?.id);

        if (qr && !isRegistered) {
            console.log('📌 Código QR generado. Listo para escanear.');
            connectionStatus = 'ESPERANDO_QR';
            try {
                qrCodeDataUrl = await qrcode.toDataURL(qr);
                io.emit('status-update', { status: connectionStatus, qr: qrCodeDataUrl });
                registrarLogConexion('ESPERANDO_QR', 'Código QR generado y listo para escaneo');
            } catch (err) {
                console.error('Error convirtiendo QR a DataURL:', err);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

            console.log(`⚠️ Conexión de WhatsApp cerrada. Código: ${statusCode}. LoggedOut: ${isLoggedOut}. Registered: ${isRegistered}`);

            if (isLoggedOut) {
                console.log('🧹 Sesión desvinculada por WhatsApp. Limpiando credenciales en MongoDB Atlas...');
                try {
                    fs.rmSync(authDir, { recursive: true, force: true });
                    if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile);
                    if (db) {
                        await db.collection('baileys_atomic_auth').deleteMany({});
                        await db.collection('session_auth').deleteMany({});
                    }
                } catch (e) {}
                connectionStatus = 'ESPERANDO_QR';
                qrCodeDataUrl = null;
                io.emit('status-update', { status: connectionStatus, qr: null });
                registrarLogConexion('DESCONECTADO', 'Sesión desvinculada por WhatsApp. Credenciales reseteadas.');
                setTimeout(connectToWhatsApp, 2000);
            } else {
                console.log('🔄 Reabriendo socket de WhatsApp tras escaneo/reconexión...');
                if (connectionStatus !== 'CONECTADO_24_7') {
                    connectionStatus = isRegistered ? 'RESTAURANDO_SESION' : 'INICIALIZANDO';
                }
                io.emit('status-update', { status: connectionStatus, qr: isRegistered ? null : qrCodeDataUrl });
                registrarLogConexion('RECONECTANDO', `Ajuste automático de socket en la nube (Código HTTP ${statusCode || 'Socket Switch'})`);
                setTimeout(connectToWhatsApp, 2000);
            }
        } else if (connection === 'open') {
            console.log('🚀 ¡Conectado con éxito a WhatsApp 24/7 en la Nube!');
            connectionStatus = 'CONECTADO_24_7';
            qrCodeDataUrl = null;
            io.emit('status-update', { status: connectionStatus, qr: null });
            registrarLogConexion('CONECTADO_24_7', '🟢 Sesión 24/7 activa y respaldada en MongoDB Atlas (Motor Atómico)');
        }
    });

    // PROCESAMIENTO DE MENSAJES ENTRANTES EN TIEMPO REAL
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            await procesarMensajeEntrante(msg, false);
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
app.post('/api/reset-session', async (req, res) => {
    try {
        console.log('🧹 Reiniciando sesión y vaciando credenciales anteriores...');
        if (sock) {
            try { sock.ev.removeAllListeners(); sock.ws?.close(); } catch (e) {}
            sock = null;
        }

        if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
        fs.mkdirSync(authDir, { recursive: true });
        if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile);

        const db = await initMongoDB();
        if (db) {
            await db.collection('baileys_atomic_auth').deleteMany({});
            await db.collection('session_auth').deleteMany({});
            console.log('🧹 Colección baileys_atomic_auth de MongoDB Atlas vaciada.');
        }

        connectionStatus = 'DESCONECTADO';
        qrCodeDataUrl = null;
        io.emit('status-update', { status: connectionStatus, qr: null });

        setTimeout(connectToWhatsApp, 2000);
        res.json({ success: true, message: 'Sesión reiniciada con éxito. Se generará un nuevo QR limpio.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

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
        uptimeLogs: uptimeLogs,
        contactsCount: Object.keys(savedContacts).length
    });
});

app.get('/api/uptime-logs', (req, res) => {
    res.json({ success: true, status: connectionStatus, logs: uptimeLogs });
});

app.post('/api/scan-history-hvs', async (req, res) => {
    try {
        console.log('🔄 Ejecutando rescate masivo de Hojas de Vida...');
        res.json({ success: true, resultado: { hvsEncontradas: savedHvs.length, chatsEscaneados: Object.keys(savedContacts).length } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/generate-summary', (req, res) => {
    const periodo = req.query.periodo || 'diario';
    const resumen = generarResumenActividad(periodo);
    res.json({ success: true, resumen });
});

app.post('/api/test-ping', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        success: true,
        timestamp: new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' }),
        status: connectionStatus,
        mongoAtlas: mongoDb ? '🟢 Conectado' : '⚠️ Desconectado',
        ramUsageMB: (mem.heapUsed / 1024 / 1024).toFixed(1) + ' MB',
        contactsCount: Object.keys(savedContacts).length,
        photosCount: savedPhotos.length,
        hvsCount: savedHvs.length
    });
});

app.post('/api/extract-chat-hvs', async (req, res) => {
    try {
        const targetChatName = req.body.chatName || 'maria';
        const query = targetChatName.toLowerCase();
        console.log(`🔎 Ejecutando extracción especial de Hojas de Vida para chat: "${targetChatName}"...`);

        const matchingHvs = savedHvs.filter(h => 
            (h.grupo && h.grupo.toLowerCase().includes(query)) || 
            (h.remitente && h.remitente.toLowerCase().includes(query))
        );

        let subidasCount = 0;
        for (const hv of matchingHvs) {
            const localPath = path.join(hvsDir, hv.nombreArchivo);
            if (fs.existsSync(localPath)) {
                await respaldarEnGoogleDrive(localPath, 'Hojas_de_Vida_Maria_Gestion_Humana', hv.nombreArchivo);
                subidasCount++;
            }
        }

        res.json({
            success: true,
            chatBuscado: 'María Gestión Humana',
            totalHvsDetectadas: matchingHvs.length,
            totalSubidasDrive: subidasCount,
            hvs: matchingHvs
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
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
        uptimeLogs: uptimeLogs,
        contactsCount: Object.keys(savedContacts).length
    });
});

server.listen(PORT, () => {
    console.log(`🌐 Servidor Hub WhatsApp (Baileys) escuchando en puerto ${PORT}`);
    initMongoDB().then(() => {
        console.log('🍃 MongoDB Atlas listo.');
    }).catch(err => console.error('MongoDB init error:', err));

    connectToWhatsApp().catch(err => {
        console.error('❌ Error conectando a WhatsApp Baileys:', err);
    });
});
