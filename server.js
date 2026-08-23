const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

const { cargarDatosDesdeMongoDB } = require('./config/database');
const { setSocketIO, connectToWhatsApp } = require('./core/whatsappClient');
const apiRoutes = require('./routes/apiRoutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Enrutador de Endpoints REST
app.use('/api', apiRoutes);

// Configurar Socket.io en el cliente de WhatsApp
setSocketIO(io);

io.on('connection', (socket) => {
    console.log(`🌐 Cliente Web conectado al Dashboard (${socket.id}).`);
});

// Inicialización de la Plataforma
async function bootstrap() {
    console.log('🚀 Inicializando Plataforma Reestructurada WhatsApp Cloud 24/7...');
    await cargarDatosDesdeMongoDB();
    await connectToWhatsApp();
    
    server.listen(PORT, () => {
        console.log(`✅ Servidor HTTP Ejecutando 24/7 en puerto ${PORT}`);
    });
}

bootstrap().catch(err => {
    console.error('💥 Error crítico en arranque del servidor:', err);
});
