const fs = require('fs');
const path = require('path');

const backupFile = path.join(__dirname, '..', 'session_backup.json');

function dumpAuthDirToMap(dir) {
    const map = {};
    if (!fs.existsSync(dir)) return map;
    try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isFile()) {
                map[file] = fs.readFileSync(fullPath, 'utf8');
            }
        }
    } catch (e) {}
    return map;
}

function restoreAuthDirFromMap(dir, map) {
    if (!map || typeof map !== 'object') return;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
        for (const file in map) {
            if (map[file] && typeof map[file] === 'string') {
                const fullPath = path.join(dir, file);
                fs.writeFileSync(fullPath, map[file], 'utf8');
            }
        }
        console.log(`📂 Espejo de llaves de autenticación oficial restaurado en ${dir} (${Object.keys(map).length} archivos).`);
    } catch (e) {
        console.error('Error restaurando carpeta de autenticación:', e.message);
    }
}

function checkIsRegisteredCreds(credsContent) {
    if (!credsContent || typeof credsContent !== 'string') return false;
    try {
        const parsed = JSON.parse(credsContent);
        return Boolean(parsed && (parsed.registered || parsed.me?.id || parsed.me));
    } catch (e) {
        return credsContent.includes('"me"') || credsContent.includes('"registered":true');
    }
}

async function sincronizarAuthDirConMongoDB(db, dir) {
    if (!db) return;
    try {
        const credsFile = path.join(dir, 'creds.json');
        if (!fs.existsSync(credsFile)) return;

        const credsContent = fs.readFileSync(credsFile, 'utf8');
        if (!checkIsRegisteredCreds(credsContent)) {
            console.log('⏳ Omitiendo respaldo de authDir: Sesión aún no registrada.');
            return;
        }

        const collection = db.collection('baileys_atomic_auth');
        const map = dumpAuthDirToMap(dir);
        if (Object.keys(map).length > 0) {
            await collection.updateOne(
                { _id: 'baileys_auth_dir_master' },
                { $set: { map: map, updatedAt: new Date() } },
                { upsert: true }
            );
            console.log(`🔒 [SELLADO MAESTRO] Bóveda de credenciales respaldada exitosamente en MongoDB Atlas (${Object.keys(map).length} llaves).`);
        }
    } catch (e) {
        console.error('Error respaldando authDir en MongoDB Atlas:', e.message);
    }
}

async function cargarAuthDirDesdeMongoDB(db, dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    // 1. Intentar restaurar desde mapa maestro baileys_auth_dir_master
    if (db) {
        try {
            const collection = db.collection('baileys_atomic_auth');
            const doc = await collection.findOne({ _id: 'baileys_auth_dir_master' });
            if (doc && doc.map && Object.keys(doc.map).length > 0) {
                const credsStr = doc.map['creds.json'] || '';
                if (checkIsRegisteredCreds(credsStr)) {
                    restoreAuthDirFromMap(dir, doc.map);
                    if (fs.existsSync(path.join(dir, 'creds.json'))) {
                        console.log(`📦 Bóveda registrada restaurada exitosamente desde MongoDB Atlas.`);
                        return;
                    }
                }
            }
        } catch (e) {}
    }

    // 2. Fallback: Restaurar creds.json desde MongoDB Atlas (registered_creds_master o creds)
    if (db) {
        try {
            const collection = db.collection('baileys_atomic_auth');
            let credsDoc = await collection.findOne({ _id: 'registered_creds_master' });
            if (!credsDoc || !credsDoc.data) {
                credsDoc = await collection.findOne({ _id: 'creds' });
            }
            if (credsDoc && credsDoc.data) {
                const credsFile = path.join(dir, 'creds.json');
                fs.writeFileSync(credsFile, JSON.stringify(credsDoc.data), 'utf8');
                console.log(`📦 creds.json recreado exitosamente desde MongoDB Atlas.`);
                return;
            }
        } catch (e) {}
    }

    // 3. Fallback: Restaurar creds.json desde session_backup.json local
    if (fs.existsSync(backupFile)) {
        try {
            const backupData = fs.readFileSync(backupFile, 'utf8');
            const credsFile = path.join(dir, 'creds.json');
            fs.writeFileSync(credsFile, backupData, 'utf8');
            console.log(`📦 creds.json recreado desde session_backup.json local.`);
        } catch (e) {}
    }
}

module.exports = {
    dumpAuthDirToMap,
    restoreAuthDirFromMap,
    sincronizarAuthDirConMongoDB,
    cargarAuthDirDesdeMongoDB
};
