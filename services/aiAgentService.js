const axios = require('axios');
const { dbState, initMongoDB } = require('../config/database');

async function buscarContenidosUniversal(query) {
    if (!query || typeof query !== 'string' || !query.trim()) {
        return {
            query: '',
            total: 0,
            resultados: []
        };
    }

    const search = query.trim();
    const regex = new RegExp(search, 'i');
    let resultados = [];

    try {
        const db = await initMongoDB();
        if (db) {
            const [msgs, audios, hvs, photos, reminders] = await Promise.all([
                db.collection('messages').find({ $or: [{ text: regex }, { sender: regex }, { group: regex }] }).limit(20).toArray().catch(() => []),
                db.collection('audios').find({ $or: [{ transcripcion: regex }, { remitente: regex }, { grupo: regex }] }).limit(20).toArray().catch(() => []),
                db.collection('hojas_de_vida').find({ $or: [{ remitente: regex }, { profesion: regex }, { descripcion: regex }, { nombreOriginal: regex }] }).limit(20).toArray().catch(() => []),
                db.collection('photos').find({ $or: [{ descripcion: regex }, { remitente: regex }, { grupo: regex }] }).limit(20).toArray().catch(() => []),
                db.collection('reminders').find({ $or: [{ mensaje: regex }, { remitente: regex }, { origen: regex }] }).limit(20).toArray().catch(() => [])
            ]);

            msgs.forEach(m => resultados.push({ tipo: '💬 Mensaje', titulo: m.sender || 'Chat', detalle: m.text, fecha: m.timestamp || '', chat: m.group || '' }));
            audios.forEach(a => resultados.push({ tipo: '🎙️ Audio Transcrito', titulo: a.remitente, detalle: a.transcripcion, fecha: `${a.fecha} ${a.hora}`, chat: a.grupo, url: a.url }));
            hvs.forEach(h => resultados.push({ tipo: '📄 Hoja de Vida', titulo: `${h.remitente} (${h.profesion})`, detalle: h.descripcion, fecha: `${h.fecha} ${h.hora}`, chat: h.grupo, url: h.url }));
            photos.forEach(p => resultados.push({ tipo: '📷 Foto HD', titulo: p.grupo, detalle: p.descripcion, fecha: `${p.fecha} ${p.hora}`, chat: p.grupo, url: p.url }));
            reminders.forEach(r => resultados.push({ tipo: '📅 Cita/Compromiso', titulo: r.remitente, detalle: r.mensaje, fecha: r.fechaDetec, chat: r.origen }));

            return {
                query: search,
                total: resultados.length,
                resultados: resultados.slice(0, 50)
            };
        }
    } catch (e) {
        console.error('Error en búsqueda MongoDB Atlas:', e.message);
    }

    // Fallback a almacenamiento en memoria
    dbState.savedPhotos.filter(p => (p.descripcion && p.descripcion.match(regex)) || (p.grupo && p.grupo.match(regex))).forEach(p => resultados.push({ tipo: '📷 Foto HD', titulo: p.grupo, detalle: p.descripcion, url: p.url }));
    dbState.savedHvs.filter(h => (h.remitente && h.remitente.match(regex)) || (h.profesion && h.profesion.match(regex))).forEach(h => resultados.push({ tipo: '📄 Hoja de Vida', titulo: `${h.remitente} (${h.profesion})`, url: h.url }));
    dbState.savedAudios.filter(a => a.transcripcion && a.transcripcion.match(regex)).forEach(a => resultados.push({ tipo: '🎙️ Audio Transcrito', titulo: a.remitente, detalle: a.transcripcion, url: a.url }));
    dbState.capturedReminders.filter(r => r.mensaje && r.mensaje.match(regex)).forEach(r => resultados.push({ tipo: '📅 Cita/Compromiso', titulo: r.remitente, detalle: r.mensaje }));

    return {
        query: search,
        total: resultados.length,
        resultados: resultados.slice(0, 50)
    };
}

async function procesarComandoIAEntrante(jid, text, senderName, groupName, getSockFunc) {
    const GROQ_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY || '';
    if (!GROQ_KEY) return 'Asistente IA no disponible (GROQ_API_KEY no configurada)';

    const promptText = text.replace(/^!(ia|bot|asistente)\s*/i, '').trim();

    try {
        const systemPrompt = `Eres Antigravity Cloud 24/7, el Agente Ejecutivo de IA oficial para Ingelec Group SAS BIC. 
Respondes en español con tono profesional, ejecutivo, eficiente y cordial.
Contexto:
- Total Hojas de Vida procesadas: ${dbState.savedHvs.length}
- Total Fotos capturadas: ${dbState.savedPhotos.length}
- Total Audios transcritos: ${dbState.savedAudios.length}
- Total Citas agendadas: ${dbState.capturedReminders.length}
Si el usuario te pide buscar información, responderás ofreciendo el resumen correspondiente.`;

        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: promptText }
            ],
            temperature: 0.5,
            max_tokens: 1000
        }, {
            headers: {
                'Authorization': `Bearer ${GROQ_KEY.trim()}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        if (response.data && response.data.choices && response.data.choices[0]) {
            const respuestaIA = response.data.choices[0].message.content.trim();
            if (jid && getSockFunc) {
                const sock = getSockFunc();
                if (sock) {
                    await sock.sendMessage(jid, { text: `🤖 *Antigravity IA Exec:* ${respuestaIA}` });
                }
            }
            return respuestaIA;
        }
        return 'No se pudo generar respuesta de IA.';
    } catch (err) {
        console.error('Error invocando LLaMA 3.3 via Groq:', err.response?.data || err.message);
        return `Error en motor agéntico IA: ${err.message}`;
    }
}

module.exports = {
    buscarContenidosUniversal,
    procesarComandoIAEntrante
};
