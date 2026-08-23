const axios = require('axios');
const fs = require('fs');

async function respaldarEnGoogleDrive(filePath, folderCategory, filename) {
    const GOOGLE_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL || process.env.GOOGLE_WEBHOOK_URL || '';
    if (!GOOGLE_WEBHOOK_URL) return;

    try {
        if (!fs.existsSync(filePath)) return;
        const fileBuffer = fs.readFileSync(filePath);
        const base64Data = fileBuffer.toString('base64');

        await axios.post(GOOGLE_WEBHOOK_URL, {
            action: 'uploadFile',
            folderCategory: folderCategory,
            filename: filename,
            fileData: base64Data
        }, { timeout: 30000 });

        console.log(`☁️ Archivo respaldado automáticamente en Google Drive (${folderCategory}/${filename}).`);
    } catch (e) {
        console.error(`⚠️ Error al respaldar en Google Drive (${filename}):`, e.message);
    }
}

module.exports = {
    respaldarEnGoogleDrive
};
