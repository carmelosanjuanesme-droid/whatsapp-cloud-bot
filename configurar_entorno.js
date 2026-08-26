const fs = require('fs');
const path = require('path');

console.log('====================================================');
console.log('🛠️ CONFIGURADOR AUTOMÁTICO DE ENTORNO (.env)');
console.log('====================================================\n');

const envPath = path.join(__dirname, '.env');

const defaultEnvContent = `# CONFIGURACIÓN AUTOMÁTICA DEL BOT 24/7
PORT=3000
GROQ_API_KEY=gsk_3Y6a9K... # Reemplazar con tu clave de Groq Whisper IA si deseas transcripción
MONGODB_URI=
TARGET_FORWARD_CHAT_NAME=Gerencia Ingelec
GOOGLE_SHEETS_WEBHOOK_URL=
`;

try {
    if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, defaultEnvContent, 'utf8');
        console.log('✅ Archivo .env CREADO AUTOMÁTICAMENTE en la raíz del proyecto.');
        console.log('   Ubicación: ' + envPath);
    } else {
        console.log('ℹ️ El archivo .env ya existía en la raíz del proyecto.');
    }
} catch (e) {
    console.error('❌ Error creando archivo .env:', e.message);
}

console.log('\n====================================================');
console.log('🎉 PASO 2 COMPLETADO CON ÉXITO');
console.log('====================================================');
