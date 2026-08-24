const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs');
const dns = require('dns');

try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {}

const MONGODB_URI = process.env.MONGODB_URI || '';
const masterDbFile = path.join(__dirname, '..', 'db_persistent_master.json');

let mongoClient = null;
let mongoDb = null;

// Estado en Memoria de la Aplicación
const dbState = {
    connectionStatus: 'INICIALIZANDO',
    qrCodeDataUrl: null,
    savedPhotos: [],
    savedHvs: [],
    savedAudios: [],
    capturedReminders: [],
    lastEvents: [],
    messageHistoryStore: [],
    rawMessageStore: [],
    savedContacts: {},
    cleanupLog: [],
    uptimeLogs: [],
    forwardingRules: [
        { tag: '#urgente', target: process.env.TARGET_FORWARD_CHAT_NAME || 'Gerencia Ingelec', active: true },
        { tag: '#gerencia', target: process.env.TARGET_FORWARD_CHAT_NAME || 'Gerencia Ingelec', active: true },
        { tag: '#reporte', target: process.env.TARGET_FORWARD_CHAT_NAME || 'Gerencia Ingelec', active: true }
    ]
};

async function initMongoDB() {
    if (mongoDb) return mongoDb;
    if (!MONGODB_URI) {
        console.log('⚠️ MONGODB_URI no configurada.');
        return null;
    }
    try {
        mongoClient = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            family: 4
        });
        await mongoClient.connect();
        mongoDb = mongoClient.db('whatsapp_bot');
        console.log('🍃 Conexión exitosa a MongoDB Atlas (Base de datos: whatsapp_bot).');
        return mongoDb;
    } catch (err) {
        console.error('⚠️ Error conectando a MongoDB Atlas:', err.message);
        return null;
    }
}

function cargarMasterStoreLocal() {
    try {
        if (fs.existsSync(masterDbFile)) {
            const raw = fs.readFileSync(masterDbFile, 'utf8');
            const data = JSON.parse(raw);
            if (data) {
                if (data.photos && Array.isArray(data.photos) && data.photos.length > 0) dbState.savedPhotos = data.photos;
                if (data.hvs && Array.isArray(data.hvs) && data.hvs.length > 0) dbState.savedHvs = data.hvs;
                if (data.audios && Array.isArray(data.audios) && data.audios.length > 0) dbState.savedAudios = data.audios;
                if (data.reminders && Array.isArray(data.reminders) && data.reminders.length > 0) dbState.capturedReminders = data.reminders;
                if (data.events && Array.isArray(data.events) && data.events.length > 0) dbState.lastEvents = data.events;
                if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) dbState.messageHistoryStore = data.messages;
                if (data.uptimeLogs && Array.isArray(data.uptimeLogs) && data.uptimeLogs.length > 0) dbState.uptimeLogs = data.uptimeLogs;
                console.log(`📦 Master Store Local cargado en 0ms: ${dbState.savedPhotos.length} fotos, ${dbState.savedHvs.length} HVs, ${dbState.savedAudios.length} audios, ${dbState.capturedReminders.length} citas.`);
            }
        }
    } catch (e) {
        console.error('Error cargando Master Store Local:', e.message);
    }
}

function guardarMasterStoreLocal() {
    try {
        const payload = {
            photos: dbState.savedPhotos,
            hvs: dbState.savedHvs,
            audios: dbState.savedAudios,
            reminders: dbState.capturedReminders,
            events: dbState.lastEvents,
            messages: dbState.messageHistoryStore.slice(0, 500),
            uptimeLogs: dbState.uptimeLogs.slice(0, 200),
            updatedAt: new Date().toISOString()
        };
        fs.writeFileSync(masterDbFile, JSON.stringify(payload, null, 2));
    } catch (e) {
        console.error('Error guardando Master Store Local:', e.message);
    }
}

// Cargar Master Store al requerir el módulo
cargarMasterStoreLocal();

async function cargarDatosDesdeMongoDB() {
    try {
        const db = await initMongoDB();
        if (db) {
            const [photos1, photos2, hvs1, hvs2, audios1, audios2, reminders1, reminders2, events, msgs, uptimes] = await Promise.all([
                db.collection('photos').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
                db.collection('fotos').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
                db.collection('hojas_de_vida').find({}).sort({ id: -1 }).limit(200).toArray().catch(() => []),
                db.collection('hvs').find({}).sort({ id: -1 }).limit(200).toArray().catch(() => []),
                db.collection('audios').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
                db.collection('notas_voz').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
                db.collection('reminders').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
                db.collection('citas').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
                db.collection('events').find({}).sort({ id: -1 }).limit(100).toArray().catch(() => []),
                db.collection('messages').find({}).sort({ id: -1 }).limit(500).toArray().catch(() => []),
                db.collection('uptime_logs').find({}).sort({ id: -1 }).limit(200).toArray().catch(() => [])
            ]);

            const mergedPhotos = [...(photos1 || []), ...(photos2 || [])];
            const mergedHvs = [...(hvs1 || []), ...(hvs2 || [])];
            const mergedAudios = [...(audios1 || []), ...(audios2 || [])];
            const mergedReminders = [...(reminders1 || []), ...(reminders2 || [])];

            if (mergedPhotos.length > 0) dbState.savedPhotos = mergedPhotos;
            if (mergedHvs.length > 0) dbState.savedHvs = mergedHvs;
            if (mergedAudios.length > 0) dbState.savedAudios = mergedAudios;
            if (mergedReminders.length > 0) dbState.capturedReminders = mergedReminders;
            if (events && events.length > 0) dbState.lastEvents = events;
            if (msgs && msgs.length > 0) dbState.messageHistoryStore = msgs;
            if (uptimes && uptimes.length > 0) dbState.uptimeLogs = uptimes;

            guardarMasterStoreLocal();
            console.log(`🍃 Datos persistentes sincronizados (con alias) desde MongoDB Atlas: ${dbState.savedPhotos.length} fotos, ${dbState.savedHvs.length} HVs, ${dbState.savedAudios.length} audios, ${dbState.capturedReminders.length} citas.`);
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

function registrarLogConexion(evento, detalle) {
    const ahora = new Date();
    const log = {
        id: Date.now(),
        fecha: ahora.toLocaleDateString('es-CO'),
        hora: ahora.toLocaleTimeString('es-CO'),
        status: dbState.connectionStatus,
        evento: evento,
        detalle: detalle
    };
    dbState.uptimeLogs.unshift(log);
    if (dbState.uptimeLogs.length > 200) dbState.uptimeLogs.pop();
    persistirItemMongoDB('uptime_logs', log);
}

module.exports = {
    dbState,
    initMongoDB,
    cargarMasterStoreLocal,
    guardarMasterStoreLocal,
    cargarDatosDesdeMongoDB,
    persistirItemMongoDB,
    registrarLogConexion
};
