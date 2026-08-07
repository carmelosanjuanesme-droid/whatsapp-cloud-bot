# 🚀 WhatsApp Automation Hub 24/7 (Nube / Render.com)

Plataforma multifuncional de automatización de WhatsApp en la nube, construida sobre **Node.js 20**, **@whiskeysockets/baileys**, **Express**, **Socket.io**, **Groq Whisper AI** y empacada en **Docker** para despliegue continuo 24/7 en **Render.com**.

---

## 📌 Visión General del Sistema
Este bot actúa como un centro de control autónomo en la nube para cuentas de **WhatsApp** o **WhatsApp Business** (iOS / Android). Se conecta mediante el protocolo nativo Multi-Device WebSocket de WhatsApp usando **Baileys**, lo que garantiza:
* **Ultraligero**: Consume solo **~30 MB de RAM** (apto para planes gratuitos de Render).
* **Persistencia de Sesión Cifrada**: Motor de resguardo `session_backup.json` / Cloud Auth para evitar re-escaneos de QR al actualizar o reiniciar.
* **Resguardo en Google Drive**: Subida automática en Base64 de fotos, audios y Hojas de Vida a Google Drive via Webhook.

---

## ⚙️ Arquitectura y Tecnologías
* **Motor WhatsApp**: `@whiskeysockets/baileys` (v6.7.5)
* **Transcripción de Audios**: Groq Whisper API (`whisper-large-v3-turbo`)
* **Servidor Web**: Express.js + Socket.io (para sincronización UI a pantalla completa en tiempo real)
* **Interfaz de Usuario**: Dashboard Web Executive Full-Screen (HTML5, Vanilla CSS Glassmorphism, JS ES6)
* **Contenedorización**: Docker (Imagen oficial `node:20`)
* **Plataforma de Hosting**: Render.com (Web Service / Docker)

---

## 🛠️ Los Módulos de Automatización Integrados

### 1. 🎙️ Transcripción de Audios de Voz con IA y Auto-Respuesta
- Intercepta notas de voz (`audioMessage`), procesa el audio con IA Whisper en español, responde automáticamente al mismo chat con el texto transcrito y lo añade al panel web.

### 2. 📄 Reservorio de Hojas de Vida (CVs) y Clasificación por Profesión
- Captura documentos PDF/Word e imágenes de postulación. Clasifica automáticamente a los candidatos en 7 categorías (Eléctrica, Civil, Administración, Sistemas, Técnico, Derecho, General).

### 3. 🔍 Escáner Retroactivo de HVs en Todos los Chats
- Recorre el historial de todos los chats y grupos para extraer Hojas de Vida enviadas en el pasado.

### 4. 📁 Resguardo Automático en Google Drive
- Transfiere en Base64 todas las imágenes, documentos y audios a carpetas organizadas en Google Drive.

### 5. 📊 Generador de Resúmenes Periódicos de Actividad
- Genera informes resumidos (diarios o semanales) de fotos, HVs, audios y citas capturadas.

### 6. 📷 Recopilación y Renombrado de Fotos HD
- Descarga fotos en HD y las renombra con formato: `[Fecha]_[Grupo]_[Remitente]_[Descripcion].jpg`.

### 7. 🔁 Reenvío Inteligente por Etiquetas
- Reenvía mensajes con `#urgente` o `#gerencia` al chat de destino (ej: *Gerencia Ingelec*).

### 8. 🧹 Limpieza de Chats Inactivos (>180 días)
- Archiva automáticamente conversaciones sin actividad por más de 6 meses.

---

## 📁 Estructura del Proyecto

```
whatsapp-cloud-bot/
├── baileys_auth_info/        # Credenciales cifradas de la sesión de WhatsApp
├── session_backup.json       # Respaldo permanente de sesión cifrada
├── public/                    # Archivos estáticos de la interfaz web
│   ├── downloads/
│   │   ├── photos/           # Galería de imágenes descargadas
│   │   ├── hojas_de_vida/    # Reservorio de Hojas de Vida (PDFs/Word)
│   │   └── audios/           # Audios de voz descargados
│   ├── app.js                 # Lógica cliente Socket.io y actualización DOM
│   ├── index.html             # Dashboard Web Full-Screen Executive
│   └── style.css              # Sistema de diseño Neo-Glassmorphic
├── Dockerfile                 # Configuración de compilación Node 20 para Render
├── package.json               # Dependencias del proyecto
├── server.js                  # Lógica principal del servidor, Baileys sockets y API REST
└── README.md                  # Guía técnica e instrucciones del desarrollador
```

---

## 🤖 Prompt Máster para Replicar en Claude Code / Cowork

Si deseas construir una solución similar e independiente en **Claude Code** o **Cowork**, copia y pega este prompt:

```text
Actúa como Desarrollador Principal de Node.js.
Crea una aplicación independiente de WhatsApp Automation Hub 24/7 desplegable en Render o Docker.

REQUERIMIENTOS:
1. Usar @whiskeysockets/baileys (v6.7.5) con compatibilidad Multi-Device para WhatsApp Business (iOS/iPhone).
2. Motor de persistencia de sesión en la nube (session_backup.json) para cero pérdida de QR al actualizar.
3. Transcripción de audios de voz con IA (Groq Whisper API) y auto-respuesta al mismo chat.
4. Reservorio de Hojas de Vida (CVs) con clasificador por 7 profesiones y escáner retroactivo de chats.
5. Resguardo automático en Google Drive via Webhook.
6. Interfaz Web Executive Full-Screen (100vw/100vh) con Sidebar y Bottom Navigation Bar para iPhone.

Crea los archivos: package.json, Dockerfile, server.js, public/index.html, public/style.css y public/app.js.
```
