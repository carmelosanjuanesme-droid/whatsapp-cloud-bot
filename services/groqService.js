const axios = require('axios');
const fs = require('fs');

async function transcribirAudioIA(filePath) {
    const GROQ_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY || '';
    if (!GROQ_KEY) {
        console.log('⚠️ GROQ_API_KEY no configurada. Saltando transcripción IA.');
        return 'Transcripción no disponible (Falta GROQ_API_KEY)';
    }

    try {
        const FormData = require('form-data');
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath), {
            filename: 'audio.ogg',
            contentType: 'audio/ogg'
        });
        form.append('model', 'whisper-large-v3-turbo');
        form.append('language', 'es');
        form.append('response_format', 'verbose_json');

        const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${GROQ_KEY.trim()}`
            },
            timeout: 60000
        });

        if (res.data && res.data.text) {
            console.log('🎙️ Transcripción Groq Whisper completada con éxito.');
            return res.data.text.trim();
        }
        return 'Transcripción procesada sin contenido de texto.';
    } catch (err) {
        console.error('⚠️ Error llamando a API Groq Whisper:', err.response?.data || err.message);
        return `Error en transcripción IA (${err.message})`;
    }
}

module.exports = {
    transcribirAudioIA
};
