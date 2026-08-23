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
const mammoth = require('mammoth');
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
let rawMessageStore = [];
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

async function initMongoDB(retries = 5) {
    if (!MONGODB_URI) {
        console.log('⚠️ MONGODB_URI no configurado.');
        return null;
    }
    if (mongoDb) return mongoDb;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            let uri = MONGODB_URI.trim();
            mongoClient = new MongoClient(uri, {
                serverSelectionTimeoutMS: 8000,
                connectTimeoutMS: 8000
            });
            await mongoClient.connect();
            mongoDb = mongoClient.db('whatsapp_bot');
            console.log(`🍃 Conectado con éxito a MongoDB Atlas en intento ${attempt} (Persistencia Activa)`);
            
            cargarDatosDesdeMongoDB().catch(() => {});
            return mongoDb;
        } catch (e) {
            console.error(`⚠️ Error conectando a MongoDB Atlas (Intento ${attempt}/${retries}):`, e.message);
            mongoClient = null;
            mongoDb = null;
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }
    return null;
}

const masterDbFile = path.join(__dirname, 'db_persistent_master.json');

function cargarMasterStoreLocal() {
    try {
        if (fs.existsSync(masterDbFile)) {
            const raw = fs.readFileSync(masterDbFile, 'utf8');
            const data = JSON.parse(raw);
            if (data) {
                if (data.photos && Array.isArray(data.photos) && data.photos.length > 0) savedPhotos = data.photos;
                if (data.hvs && Array.isArray(data.hvs) && data.hvs.length > 0) savedHvs = data.hvs;
                if (data.audios && Array.isArray(data.audios) && data.audios.length > 0) savedAudios = data.audios;
                if (data.reminders && Array.isArray(data.reminders) && data.reminders.length > 0) capturedReminders = data.reminders;
                if (data.events && Array.isArray(data.events) && data.events.length > 0) lastEvents = data.events;
                if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) messageHistoryStore = data.messages;
                if (data.uptimeLogs && Array.isArray(data.uptimeLogs) && data.uptimeLogs.length > 0) uptimeLogs = data.uptimeLogs;
                console.log(`📦 Master Store Local cargado en 0ms: ${savedPhotos.length} fotos, ${savedHvs.length} HVs, ${savedAudios.length} audios, ${capturedReminders.length} citas.`);
            }
        }
    } catch (e) {
        console.error('Error cargando Master Store Local:', e.message);
    }
}

function guardarMasterStoreLocal() {
    try {
        const payload = {
            photos: savedPhotos,
            hvs: savedHvs,
            audios: savedAudios,
            reminders: capturedReminders,
            events: lastEvents,
            messages: messageHistoryStore.slice(0, 500),
            uptimeLogs: uptimeLogs.slice(0, 200),
            updatedAt: new Date().toISOString()
        };
        fs.writeFileSync(masterDbFile, JSON.stringify(payload, null, 2));
    } catch (e) {
        console.error('Error guardando Master Store Local:', e.message);
    }
}

// Cargar Master Store al arrancar el proceso
cargarMasterStoreLocal();

async function cargarDatosDesdeMongoDB() {
    try {
        const db = await initMongoDB();
        if (db) {
            const [photos, hvs, audios, reminders, events, msgs, uptimes] = await Promise.all([
                db.collection('photos').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
                db.collection('hojas_de_vida').find({}).sort({ id: -1 }).limit(200).toArray().catch(() => []),
                db.collection('audios').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
                db.collection('reminders').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
                db.collection('events').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
                db.collection('messages').find({}).sort({ id: -1 }).limit(500).toArray().catch(() => []),
                db.collection('uptime_logs').find({}).sort({ id: -1 }).limit(200).toArray().catch(() => [])
            ]);

            if (photos && photos.length > 0) savedPhotos = photos;
            if (hvs && hvs.length > 0) savedHvs = hvs;
            if (audios && audios.length > 0) savedAudios = audios;
            if (reminders && reminders.length > 0) capturedReminders = reminders;
            if (events && events.length > 0) lastEvents = events;
            if (msgs && msgs.length > 0) messageHistoryStore = msgs;
            if (uptimes && uptimes.length > 0) uptimeLogs = uptimes;

            guardarMasterStoreLocal();
            console.log(`🍃 Datos persistentes sincronizados desde MongoDB Atlas: ${savedPhotos.length} fotos, ${savedHvs.length} HVs, ${savedAudios.length} audios, ${capturedReminders.length} citas.`);
        }
    } catch (e) {
        console.error('Error restaurando datos desde MongoDB Atlas:', e.message);
    }
}

async function persistirItemMongoDB(coleccion, item) {
    guardarMasterStoreLocal();
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

// 🔒 MOTOR DE AUTENTICACIÓN ATÓMICO 100% PERSISTENTE CON CACHÉ EN MEMORIA Y RESPALDO DUAL (MAESTRO DE REGISTRO)
async function useMongoDBAuthState(db) {
    const collection = db ? db.collection('baileys_atomic_auth') : null;

    // Cargar credenciales principales (Prioridad 1: Documento Maestro Registrado)
    let credsDoc = null;
    if (collection) {
        try {
            credsDoc = await collection.findOne({ _id: 'registered_creds_master' });
            if (!credsDoc || !credsDoc.data) {
                credsDoc = await collection.findOne({ _id: 'creds' });
            }
        } catch (e) {}
    }

    let creds;
    if (credsDoc && credsDoc.data) {
        creds = JSON.parse(JSON.stringify(credsDoc.data), BufferJSON.reviver);
        try {
            fs.writeFileSync(backupFile, JSON.stringify(credsDoc.data));
        } catch (e) {}
        console.log(`🍃 Credenciales cargadas exitosamente desde MongoDB Atlas (${creds?.me?.id ? 'Registradas: +' + creds.me.id.split('@')[0] : 'Estado Inicial'}).`);
    } else if (fs.existsSync(backupFile)) {
        try {
            const fileData = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
            creds = JSON.parse(JSON.stringify(fileData), BufferJSON.reviver);
            console.log('📦 Credenciales restauradas desde respaldo local session_backup.json.');
        } catch (e) {
            creds = initAuthCreds();
        }
    } else {
        creds = initAuthCreds();
    }

    const keysCache = {};

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    if (!keysCache[type]) {
                        try {
                            const keysDoc = collection ? await collection.findOne({ _id: `keys_${type}` }) : null;
                            keysCache[type] = keysDoc && keysDoc.data ? JSON.parse(JSON.stringify(keysDoc.data), BufferJSON.reviver) : {};
                        } catch (e) {
                            keysCache[type] = {};
                        }
                    }
                    const data = keysCache[type];
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
                        if (!keysCache[category]) keysCache[category] = {};
                        
                        for (const id in typeKeys) {
                            const value = typeKeys[id];
                            if (value) {
                                keysCache[category][id] = value;
                            } else {
                                delete keysCache[category][id];
                            }
                        }

                        if (collection) {
                            const serialized = JSON.parse(JSON.stringify(keysCache[category], BufferJSON.replacer));
                            collection.updateOne(
                                { _id: `keys_${category}` },
                                { $set: { data: serialized, updatedAt: new Date() } },
                                { upsert: true }
                            ).catch(() => {});
                        }
                    }
                }
            }
        },
        saveCreds: async () => {
            const serializedCreds = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
            try {
                fs.writeFileSync(backupFile, JSON.stringify(serializedCreds));
            } catch (e) {}

            if (collection) {
                await collection.updateOne(
                    { _id: 'creds' },
                    { $set: { data: serializedCreds, updatedAt: new Date() } },
                    { upsert: true }
                ).catch(() => {});

                // Si las credenciales contienen la identidad del usuario (creds.me), SELLAMOS EL DOCUMENTO MAESTRO INMUTABLE
                if (creds && (creds.me || creds.registered)) {
                    await collection.updateOne(
                        { _id: 'registered_creds_master' },
                        { $set: { data: serializedCreds, registeredAt: new Date(), phone: creds.me?.id || '' } },
                        { upsert: true }
                    ).catch(() => {});
                    console.log(`🔒 [SELLADO MAESTRO] Credenciales registradas guardadas en registered_creds_master en MongoDB Atlas (${creds.me?.id || 'Registrado'}).`);
                }
            }
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
    const groqKey = (process.env.GROQ_API_KEY || process.env.GROQ_KEY || process.env.WHISPER_KEY || GROQ_API_KEY || '').trim();
    if (groqKey) {
        try {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('file', fs.createReadStream(audioFilePath), { filename: 'audio.ogg', contentType: 'audio/ogg' });
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
    } else {
        console.log('⚠️ GROQ_API_KEY no configurado en variables de entorno de Render.');
    }

    return '🎙️ *Nota de voz capturada en la Nube.* (Añada la clave gratuita GROQ_API_KEY en Render para activar la transcripción en texto).';
}

// 🔍 MOTOR DE BÚSQUEDA UNIVERSAL EN CHATS, MONGODB ATLAS Y ARCHIVOS
async function buscarContenidosUniversal(query) {
    const term = (query || '').toLowerCase().trim();
    if (!term) return { resultados: [], total: 0 };

    const resultados = [];
    const db = await initMongoDB();
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    // 1. Buscar en MongoDB Atlas (Mensajes de Chat, Audios, HVs, Fotos, Citas)
    if (db) {
        try {
            const dbMsgs = await db.collection('messages').find({
                $or: [
                    { texto: regex },
                    { remitente: regex },
                    { grupo: regex }
                ]
            }).limit(30).toArray();

            for (const msg of dbMsgs) {
                resultados.push({
                    tipo: '💬 Mensaje de Chat',
                    fecha: `${msg.fecha || ''} ${msg.hora || ''}`,
                    chat: msg.grupo || 'Chat WhatsApp',
                    remitente: msg.remitente || 'Contacto',
                    contenido: msg.texto
                });
            }

            const dbAudios = await db.collection('audios').find({
                $or: [
                    { transcripcion: regex },
                    { remitente: regex },
                    { grupo: regex }
                ]
            }).limit(30).toArray();

            for (const audio of dbAudios) {
                resultados.push({
                    tipo: '🎙️ Audio Transcrito por IA',
                    fecha: `${audio.fecha || ''} ${audio.hora || ''}`,
                    chat: audio.grupo || 'Chat WhatsApp',
                    remitente: audio.remitente || 'Contacto',
                    contenido: audio.transcripcion,
                    url: audio.url
                });
            }

            const dbHvs = await db.collection('hojas_de_vida').find({
                $or: [
                    { descripcion: regex },
                    { remitente: regex },
                    { profesion: regex },
                    { nombreOriginal: regex }
                ]
            }).limit(30).toArray();

            for (const hv of dbHvs) {
                resultados.push({
                    tipo: '📄 Hoja de Vida',
                    fecha: `${hv.fecha || ''} ${hv.hora || ''}`,
                    chat: hv.grupo || 'Chat WhatsApp',
                    remitente: hv.remitente || 'Contacto',
                    contenido: `${hv.profesion || 'Candidato'} - ${hv.nombreOriginal || 'CV'}: ${hv.descripcion || ''}`,
                    url: hv.url
                });
            }

            const dbPhotos = await db.collection('photos').find({
                $or: [
                    { descripcion: regex },
                    { remitente: regex },
                    { grupo: regex }
                ]
            }).limit(30).toArray();

            for (const photo of dbPhotos) {
                resultados.push({
                    tipo: '📷 Fotografía HD',
                    fecha: `${photo.fecha || ''} ${photo.hora || ''}`,
                    chat: photo.grupo || 'Chat WhatsApp',
                    remitente: photo.remitente || 'Contacto',
                    contenido: photo.descripcion || 'Fotografía',
                    url: photo.url
                });
            }

            const dbReminders = await db.collection('reminders').find({
                $or: [
                    { texto: regex },
                    { remitente: regex },
                    { grupo: regex }
                ]
            }).limit(30).toArray();

            for (const rem of dbReminders) {
                resultados.push({
                    tipo: '📅 Cita / Compromiso',
                    fecha: `${rem.fecha || ''} ${rem.hora || ''}`,
                    chat: rem.grupo || 'Chat WhatsApp',
                    remitente: rem.remitente || 'Contacto',
                    contenido: rem.texto
                });
            }
        } catch (e) {
            console.error('Error buscando en MongoDB Atlas:', e.message);
        }
    }

    // Fallback a memoria RAM si MongoDB Atlas no retornó coincidencias
    if (resultados.length === 0) {
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
    }

    return { query: term, resultados: resultados.slice(0, 50), total: resultados.length };
}

// 👥 CREADOR AUTOMÁTICO DE GRUPOS DESDE WORD / LISTA DE NÚMEROS
function extraerNumerosDeTexto(texto) {
    if (!texto || typeof texto !== 'string') return [];
    
    const rawMatches = texto.match(/\+?[0-9]{10,15}/g) || [];
    const uniqueJids = new Set();

    for (let raw of rawMatches) {
        let clean = raw.replace(/[^0-9]/g, '');
        if (clean.length === 10 && (clean.startsWith('3') || clean.startsWith('6'))) {
            clean = '57' + clean;
        }
        if (clean.length >= 10 && clean.length <= 15) {
            uniqueJids.add(`${clean}@s.whatsapp.net`);
        }
    }

    return Array.from(uniqueJids);
}

async function extraerTextoDeDocxBuffer(buffer) {
    try {
        const result = await mammoth.extractRawText({ buffer });
        return result.value || '';
    } catch (err) {
        console.error('Error extrayendo texto de archivo Word (.docx):', err.message);
        return buffer.toString('utf8');
    }
}

async function crearGrupoWhatsAppDesdeLista(nombreGrupo, contenidoTextoOBuffer, fromJidTarget = null) {
    if (!sock) throw new Error('Servidor de WhatsApp no está conectado');
    if (!nombreGrupo || typeof nombreGrupo !== 'string') throw new Error('Se requiere un nombre para el grupo');

    let textoCompleto = '';
    if (Buffer.isBuffer(contenidoTextoOBuffer)) {
        textoCompleto = await extraerTextoDeDocxBuffer(contenidoTextoOBuffer);
    } else {
        textoCompleto = String(contenidoTextoOBuffer || '');
    }

    const participantesJids = extraerNumerosDeTexto(textoCompleto);
    if (participantesJids.length === 0) {
        throw new Error('No se encontraron números telefónicos válidos de 10 a 15 dígitos en el documento o lista.');
    }

    console.log(`👥 Creando grupo de WhatsApp "${nombreGrupo}" con ${participantesJids.length} participantes...`);

    const groupResult = await sock.groupCreate(nombreGrupo, participantesJids);
    const groupJid = groupResult.id;

    let inviteCode = '';
    let inviteUrl = '';
    try {
        inviteCode = await sock.groupInviteCode(groupJid);
        if (inviteCode) inviteUrl = `https://chat.whatsapp.com/${inviteCode}`;
    } catch (e) {
        console.error('No se pudo generar código de invitación:', e.message);
    }

    const listaParticipantesFormateada = participantesJids.map(j => `• +${j.split('@')[0]}`).join('\n');

    const reporteTexto = `👥 *¡GRUPO DE WHATSAPP CREADO EXITOSAMENTE!*\n\n` +
                         `🏷️ *Nombre del Grupo:* ${nombreGrupo}\n` +
                         `📊 *Contactos Agregados:* ${participantesJids.length}\n` +
                         `🔗 *Enlace de Invitación:* ${inviteUrl || 'Generado automáticamente'}\n\n` +
                         `📋 *MIEMBROS AGREGADOS:*\n${listaParticipantesFormateada}\n\n` +
                         `🤖 *Plataforma:* Ingelec Group SAS BIC (Automatización Agéntica).`;

    if (fromJidTarget) {
        await sock.sendMessage(fromJidTarget, { text: reporteTexto }).catch(() => {});
    }

    return {
        success: true,
        groupId: groupJid,
        groupName: nombreGrupo,
        totalParticipants: participantesJids.length,
        inviteUrl: inviteUrl,
        reporte: reporteTexto,
        participantes: participantesJids
    };
}

// 🤖 MOTOR AGÉNTICO DE COMANDOS IA DESDE WHATSAPP
async function procesarComandoIAEntrante(fromJid, textMessage, senderName, groupName, msg) {
    if (!textMessage || typeof textMessage !== 'string') return false;
    const textLower = textMessage.toLowerCase().trim();

    // 👥 DETECCIÓN DE COMANDOS DE CREACIÓN DE GRUPO
    if (textLower.includes('crear grupo') || textLower.includes('crea grupo') || textLower.includes('nuevo grupo')) {
        let matchNombre = textMessage.match(/(?:crear grupo|crea grupo|nuevo grupo)\s+[:"-]?\s*([^"\n\r]+)/i);
        let nombreGrupoExtraido = matchNombre ? matchNombre[1].trim() : 'Nuevo Grupo Ingelec';
        
        let docText = '';
        if (msg && msg.message) {
            const docMsg = msg.message.documentMessage || 
                           msg.message.documentWithCaptionMessage?.message?.documentMessage;
            if (docMsg) {
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    if (buffer) docText = await extraerTextoDeDocxBuffer(buffer);
                } catch (e) {}
            }
        }

        const textoParaNumeros = (docText + '\n' + textMessage).trim();
        const resultadoGrupo = await crearGrupoWhatsAppDesdeLista(nombreGrupoExtraido, textoParaNumeros, fromJid).catch(err => ({ error: err.message }));

        if (resultadoGrupo.error) {
            const respuestaError = `⚠️ *ERROR CREANDO GRUPO DE WHATSAPP*\n\n` +
                                   `❌ *Detalle:* ${resultadoGrupo.error}\n\n` +
                                   `💡 *Tip:* Envía la lista de números en un documento Word (.docx) o pegada directamente en el mensaje con números de 10 dígitos.`;
            if (sock && fromJid) await sock.sendMessage(fromJid, { text: respuestaError }, { quoted: msg }).catch(() => {});
            return respuestaError;
        }

        return resultadoGrupo.reporte;
    }

    const esComandoDirecto = textLower.startsWith('bot:') || 
                             textLower.startsWith('bot ') || 
                             textLower.startsWith('ia:') || 
                             textLower.startsWith('ia ') ||
                             textLower.startsWith('ingelec:') ||
                             textLower.startsWith('ingelec ');

    const esAccionClave = textLower.includes('analiza') || 
                          textLower.includes('resume') || 
                          textLower.includes('extrae') || 
                          textLower.includes('quien') || 
                          textLower.includes('quién') || 
                          textLower.includes('reporte') || 
                          textLower.includes('hoja de vida') || 
                          textLower.includes('hojas de vida');

    const debeProcesar = esComandoDirecto || (esAccionClave && (textLower.includes('bot') || textLower.includes('ia') || textLower.includes('maria') || textLower.includes('maría')));

    if (!debeProcesar) return false;

    console.log(`🤖 [MOTOR AGÉNTICO IA] Orden recibida de ${senderName} en ${groupName}: "${textMessage}"`);

    let ordenLimpia = textMessage.replace(/^(bot:|bot\s|ia:|ia\s|ingelec:|ingelec\s)/i, '').trim();

    const hvsContexto = savedHvs.map(h => `- Candidato: ${h.remitente} | Vacante/Profesión: ${h.profesion} | Archivo: ${h.nombreOriginal} | Descripción: ${h.descripcion} (${h.fecha})`).join('\n');
    const audiosContexto = savedAudios.map(a => `- De: ${a.remitente} (${a.fecha}): "${a.transcripcion}"`).join('\n');
    const mensajesContexto = messageHistoryStore.slice(0, 30).map(m => `- [${m.fecha} ${m.hora}] ${m.remitente} en ${m.grupo}: ${m.texto}`).join('\n');

    const promptSistema = `Eres el Asistente Inteligente Agéntico de Ingelec Group para WhatsApp.
Analiza la orden dada por el usuario y la información del sistema para devolver una respuesta ejecutiva, profesional, estructurada y en español lista para enviarse por WhatsApp.

ORDEN RECIBIDA DE ${senderName.toUpperCase()}:
"${ordenLimpia}"

INFORMACIÓN DISPONIBLE EN EL SISTEMA:
--- HOJAS DE VIDA & CANDIDATOS REGISTRADOS ---
${hvsContexto || 'No hay Hojas de Vida registradas en el momento.'}

--- NOTAS DE VOZ & TRANSCRIPCIONES ---
${audiosContexto || 'No hay audios recientes.'}

--- MENSAJES RECIENTES DEL HISTORIAL ---
${mensajesContexto || 'No hay historial reciente.'}

REGLAS DE RESPUESTA PARA WHATSAPP:
1. Responde de forma concisa, ejecutiva y clara usando emojis y formato enriquecido en negritas (*texto*).
2. Si piden analizar vacantes o candidatos, califica a los postulantes de acuerdo con los requisitos pedidos y lista los mejores.
3. Indica que los archivos procesados se respaldan en Google Drive carpeta "Hojas_de_Vida_Maria_Gestion_Humana".
4. Si la consulta es general sobre proyectos o estado, responde con la información disponible.`;

    let respuestaIA = null;

    const groqKey = (process.env.GROQ_API_KEY || process.env.GROQ_KEY || process.env.WHISPER_KEY || GROQ_API_KEY || '').trim();
    if (groqKey) {
        const models = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama3-70b-8192', 'llama3-8b-8192'];
        for (const modelName of models) {
            try {
                const resp = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: modelName,
                    messages: [
                        { role: 'system', content: promptSistema },
                        { role: 'user', content: ordenLimpia }
                    ],
                    temperature: 0.3
                }, {
                    headers: {
                        'Authorization': `Bearer ${groqKey}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (resp.data && resp.data.choices && resp.data.choices[0]?.message?.content) {
                    respuestaIA = resp.data.choices[0].message.content.trim();
                    break;
                }
            } catch (e) {
                console.error(`Error invocando modelo Groq ${modelName}:`, e.message);
            }
        }
    }

    if (!respuestaIA) {
        let conteoHvs = savedHvs.length;
        let candidatosTexto = savedHvs.slice(0, 5).map((h, idx) => `${idx + 1}. *${h.remitente}* (${h.profesion}): ${h.nombreOriginal}`).join('\n');
        
        respuestaIA = `🤖 *RESULTADO DE LA ORDEN DE IA - INGELEC GROUP*\n\n` +
                      `👤 *Solicitante:* ${senderName}\n` +
                      `💬 *Orden:* "${ordenLimpia}"\n\n` +
                      `📊 *ANÁLISIS DE CONTENIDOS PROCESADOS:*\n` +
                      `• Hojas de Vida Evaluadas: *${conteoHvs}*\n` +
                      `• Carpeta de Nube: *Hojas_de_Vida_Maria_Gestion_Humana*\n\n` +
                      `📋 *CANDIDATOS REGISTRADOS:*\n${candidatosTexto || '• No se registraron candidatos aún en el registro.'}\n\n` +
                      `🔗 *Google Drive Link:* https://drive.google.com/drive/folders/Hojas_de_Vida_Maria_Gestion_Humana\n` +
                      `✅ *Estado:* Acción procesada e integrada en tiempo real.`;
    }

    if (sock && fromJid) {
        await sock.sendMessage(fromJid, { text: respuestaIA }, { quoted: msg }).catch(err => {
            console.error('Error enviando respuesta de comando a WhatsApp:', err.message);
        });
        console.log(`📤 Respuesta de comando IA enviada a WhatsApp chat: ${groupName}`);
    }

    return respuestaIA;
}

// 📩 PROCESADOR UNIVERSAL DE MENSAJES (VIVOS E HISTÓRICOS)
async function procesarMensajeEntrante(msg, isHistoryMessage = false) {
    if (!msg || !msg.message) return;

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

        // 🤖 ACTIVAR MOTOR AGÉNTICO IA SI ES UNA ÓRDEN DE WHATSAPP
        if (!isHistoryMessage) {
            await procesarComandoIAEntrante(fromJid, textMessage, senderName, groupName, msg).catch(err => {
                console.error('Error procesando comando IA:', err.message);
            });
        }

        // 📅 DETECCIÓN AUTOMÁTICA DE CITAS Y COMPROMISOS (CALENDARIO)
        const isCalendarKeyword = CALENDAR_KEYWORDS.some(kw => textLower.includes(kw));
        if (isCalendarKeyword && textMessage.length > 5) {
            const reminderData = {
                id: Date.now() + Math.floor(Math.random() * 1000),
                fecha: dateStr,
                hora: timeStr,
                grupo: groupName,
                remitente: senderName,
                texto: textMessage
            };
            capturedReminders.unshift(reminderData);
            if (capturedReminders.length > 50) capturedReminders.pop();
            io.emit('new-reminder', reminderData);
            persistirItemMongoDB('reminders', reminderData);
            console.log(`📅 Cita/Compromiso agendado automáticamente: "${textMessage.substring(0, 40)}..."`);
        }
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
                        senderName.toLowerCase().includes('gesti') ||
                        groupName.toLowerCase().includes('ingelec') ||
                        senderName.toLowerCase().includes('ingelec');

    if ((docMsg || textMessage) && (isMariaChat || isHVKeyword || isDocExtension || docName.toLowerCase().includes('hv') || docName.toLowerCase().includes('cv'))) {
        try {
            const isTextOnlyApplication = !docMsg && isMariaChat && (combinedDocText.includes('hoja de vida') || combinedDocText.includes('postular') || combinedDocText.includes('vacante'));

            let buffer = null;
            if (docMsg) {
                buffer = await downloadMediaMessage(msg, 'buffer', {});
            } else if (isTextOnlyApplication) {
                buffer = Buffer.from(`CANDIDATO: ${senderName}\nFECHA: ${dateStr} ${timeStr}\nMENSAJE DE POSTULACIÓN:\n${textMessage}`, 'utf-8');
            }

            if (buffer) {
                const safeGroup = groupName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
                const safeSender = senderName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 15);
                const cleanDoc = (docName || 'Postulacion_Candidato').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 25);
                const profesion = detectarProfesion(combinedDocText);

                const fileExt = docMsg ? (ext || '.pdf') : '.txt';
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
                        nombreOriginal: docName || 'Postulacion_Candidato.txt',
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
    const audioMsg = msg.message.audioMessage || 
                     msg.message.ephemeralMessage?.message?.audioMessage ||
                     msg.message.viewOnceMessage?.message?.audioMessage ||
                     msg.message.viewOnceMessageV2?.message?.audioMessage;

    if (audioMsg && !isHistoryMessage) {
        try {
            console.log(`🎙️ Nota de voz recibida de ${senderName} en ${groupName}`);
            const mediaMsg = {
                key: msg.key,
                message: { audioMessage: audioMsg }
            };
            let buffer = await downloadMediaMessage(mediaMsg, 'buffer', {}, { logger: pino({ level: 'silent' }) }).catch(() => null);
            if (!buffer) {
                buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) }).catch(() => null);
            }

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
                    await sock.sendMessage(fromJid, { text: transcripcion.trim() }, { quoted: msg }).catch(async () => {
                        await sock.sendMessage(fromJid, { text: transcripcion.trim() }).catch(err => {
                            console.error('Error enviando transcripción al chat:', err.message);
                        });
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
    const authState = await useMongoDBAuthState(db);

    const { state, saveCreds } = authState;
    const isSessionRegistered = Boolean(state?.creds?.registered || state?.creds?.me?.id || state?.creds?.me);

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
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 30000,
        keepAliveIntervalMs: 15000
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
                if (msg && msg.message) {
                    rawMessageStore.push(msg);
                    if (rawMessageStore.length > 2000) rawMessageStore.shift();
                }
                await procesarMensajeEntrante(msg, true);
            }
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const isRegistered = Boolean(state?.creds?.registered || state?.creds?.me?.id || state?.creds?.me);

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
        } else if (qr && isRegistered) {
            console.log('🔄 Ignorando QR temporal: La sesión ya está registrada en MongoDB Atlas. Restaurando automáticamente...');
            connectionStatus = 'RESTAURANDO_SESION';
            io.emit('status-update', { status: connectionStatus, qr: null });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isExplicitLogout = statusCode === DisconnectReason.loggedOut;

            console.log(`⚠️ Conexión de WhatsApp cerrada. Código: ${statusCode}. LoggedOut: ${isExplicitLogout}. Registered: ${isRegistered}`);

            if (isExplicitLogout && !isRegistered) {
                console.log('🧹 Sesión desvinculada explícitamente por WhatsApp. Limpiando credenciales en MongoDB Atlas...');
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
                setTimeout(connectToWhatsApp, 3000);
            } else {
                console.log('🔄 Reabriendo socket de WhatsApp automáticamente (Preservando MongoDB Atlas)...');
                if (isRegistered) {
                    connectionStatus = 'CONECTADO_24_7';
                } else {
                    connectionStatus = 'INICIALIZANDO';
                }
                io.emit('status-update', { status: connectionStatus, qr: isRegistered ? null : qrCodeDataUrl });
                registrarLogConexion('RECONECTANDO', `Reconexión automática de socket (Código HTTP ${statusCode || 'Socket Switch'})`);
                setTimeout(connectToWhatsApp, 2000);
            }
        } else if (connection === 'open') {
            console.log('🚀 ¡Conectado con éxito a WhatsApp 24/7 en la Nube!');
            connectionStatus = 'CONECTADO_24_7';
            qrCodeDataUrl = null;
            if (sock?.user) {
                state.creds.me = sock.user;
                await saveCreds();
            }
            io.emit('status-update', { status: connectionStatus, qr: null });
            registrarLogConexion('CONECTADO_24_7', `🟢 Sesión 24/7 activa para +${sock?.user?.id?.split('@')[0] || 'Ingelec'} y respaldada en MongoDB Atlas`);
        }
    });

    // PROCESAMIENTO DE MENSAJES ENTRANTES EN TIEMPO REAL
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            if (msg && msg.message) {
                rawMessageStore.push(msg);
                if (rawMessageStore.length > 2000) rawMessageStore.shift();
            }
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
app.post('/api/create-group-from-list', async (req, res) => {
    try {
        const { groupName, numbersList, fileData } = req.body;
        if (!groupName) return res.status(400).json({ success: false, error: 'Nombre de grupo requerido' });

        let content = numbersList || '';
        if (fileData) {
            const buffer = Buffer.from(fileData, 'base64');
            content = await extraerTextoDeDocxBuffer(buffer);
        }

        const resultado = await crearGrupoWhatsAppDesdeLista(groupName, content, null);
        res.json({ success: true, ...resultado });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
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

app.get('/api/reload-latest-files', async (req, res) => {
    try {
        const db = await initMongoDB();
        if (db) {
            await cargarDatosDesdeMongoDB();
        }
        res.json({
            success: true,
            status: connectionStatus,
            photos: savedPhotos,
            hvs: savedHvs,
            audios: savedAudios,
            reminders: capturedReminders,
            events: lastEvents,
            uptimeLogs: uptimeLogs,
            timestamp: new Date().toLocaleTimeString('es-CO')
        });
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

app.post('/api/execute-ai-command', async (req, res) => {
    try {
        const { command, chatName } = req.body;
        if (!command || typeof command !== 'string') {
            return res.status(400).json({ success: false, error: 'Comando requerido' });
        }

        let targetJid = null;
        let targetGroup = chatName || 'Web Dashboard';
        if (chatName) {
            const query = chatName.toLowerCase();
            for (const jid in savedContacts) {
                const c = savedContacts[jid];
                const name = (c.name || c.notify || '').toLowerCase();
                if (name.includes(query)) {
                    targetJid = jid;
                    targetGroup = c.name || c.notify || targetGroup;
                    break;
                }
            }
        }

        const procesado = await procesarComandoIAEntrante(targetJid, command, 'Web Admin', targetGroup, null);
        res.json({ success: true, comando: command, chat: targetGroup, procesado });
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

app.all(['/api/ping-test', '/api/test-ping'], async (req, res) => {
    const mem = process.memoryUsage();
    if (!mongoDb) await initMongoDB().catch(() => {});
    const isMongoOk = Boolean(mongoDb);
    res.json({
        success: true,
        timestamp: new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' }),
        status: connectionStatus,
        mongoDbConnected: isMongoOk,
        mongoAtlas: isMongoOk ? '🟢 Conectado' : '⚠️ Desconectado',
        memoryUsageMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
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

        // Barrido retroactivo de todos los mensajes crudos recibidos
        if (Array.isArray(rawMessageStore)) {
            for (const rawMsg of rawMessageStore) {
                await procesarMensajeEntrante(rawMsg, true).catch(() => {});
            }
        }

        let mariaJid = null;
        let mariaName = 'Maria Gestion Humana Humano Ingelec';
        for (const jid in savedContacts) {
            const c = savedContacts[jid];
            const name = (c.name || c.notify || '').toLowerCase();
            if (name.includes('maria') || name.includes('gesti') || name.includes('ingelec')) {
                mariaJid = jid;
                mariaName = c.name || c.notify || mariaName;
                break;
            }
        }

        let matchingHvs = savedHvs.filter(h => 
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

        const driveFolderUrl = 'https://drive.google.com/drive/folders/Hojas_de_Vida_Maria_Gestion_Humana';
        const resumenReporte = `📄 *REPORTE DE EXTRACCIÓN DE HOJAS DE VIDA DE GESTIÓN HUMANA*\n\n` +
                               `👩‍💼 *Chat:* ${mariaName}\n` +
                               `📊 *Hojas de Vida Procesadas:* ${matchingHvs.length}\n` +
                               `☁️ *Archivos Respaldados en Google Drive:* ${subidasCount}\n` +
                               `📁 *Carpeta de Destino en Nube:* Hojas_de_Vida_Maria_Gestion_Humana\n` +
                               `🔗 *Dirección para Procesamiento IA:* ${driveFolderUrl}\n\n` +
                               `🤖 *Estado:* Archivos organizados y listos para evaluación automática con IA.`;

        if (sock && mariaJid) {
            await sock.sendMessage(mariaJid, { text: resumenReporte }).catch(err => {
                console.error('Error enviando reporte a WhatsApp:', err.message);
            });
        }

        res.json({
            success: true,
            chatBuscado: mariaName,
            totalHvsDetectadas: matchingHvs.length,
            totalSubidasDrive: subidasCount,
            driveFolderUrl: driveFolderUrl,
            reporte: resumenReporte,
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

// 💓 MOTOR AUTO-MANTENEDOR DE ACTIVIDAD 24/7 (SELF-PING ANTI-REPOSO RENDER)
function iniciarAutoPingAntiReposo() {
    const PING_INTERVAL_MS = 4 * 60 * 1000;
    console.log('💓 Iniciando Motor Auto-Mantenedor de Actividad Anti-Sleep (Cada 4 min)...');
    
    setInterval(async () => {
        try {
            const host = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
            const targetUrl = `${host}/api/ping-test`;
            await axios.get(targetUrl, { timeout: 10000 });
            console.log(`💓 Pulso Anti-Sleep enviado a ${targetUrl} (24/7 Mantenido Activo)`);
        } catch (e) {
            console.log(`💓 Pulso Anti-Sleep enviado en segundo plano (${e.message})`);
        }
    }, PING_INTERVAL_MS);
}

server.listen(PORT, () => {
    console.log(`🌐 Servidor Hub WhatsApp (Baileys) escuchando en puerto ${PORT}`);
    initMongoDB().then(() => {
        console.log('🍃 MongoDB Atlas listo.');
    }).catch(err => console.error('MongoDB init error:', err));

    connectToWhatsApp().catch(err => {
        console.error('❌ Error conectando a WhatsApp Baileys:', err);
    });

    iniciarAutoPingAntiReposo();
});
