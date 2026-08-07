# 🚀 WhatsApp Automation Hub 24/7 (Nube / Render.com)

Plataforma multifuncional de automatización de WhatsApp en la nube, construida sobre **Node.js**, **@whiskeysockets/baileys**, **Express**, **Socket.io** y empacada en **Docker** para despliegue continuo 24/7 en **Render.com**.

---

## 📌 Visión General del Sistema
Este bot actúa como un centro de control autónomo en la nube para cuentas de **WhatsApp** o **WhatsApp Business** (iOS / Android). Se conecta mediante el protocolo nativo Multi-Device WebSocket de WhatsApp usando **Baileys**, lo que garantiza:
* **Ultraligero**: Consume solo **~30 MB de RAM** (apto para planes gratuitos de Render).
* **Generación de QR instantánea**: Caza de credenciales en <1 segundo.
* **Persistencia 24/7**: Mantiene la sesión activa al reiniciar el servidor utilizando `useMultiFileAuthState`.

---

## ⚙️ Arquitectura y Tecnologías
* **Motor WhatsApp**: `@whiskeysockets/baileys` (v6.7.5)
* **Servidor Web**: Express.js + Socket.io (para sincronización UI en tiempo real)
* **Interfaz de Usuario**: Dashboard Web Neo-Glassmorphism (HTML5, Vanilla CSS, JS ES6)
* **Contenedorización**: Docker (Imagen oficial `node:20`)
* **Plataforma de Hosting**: Render.com (Web Service / Docker)

---

## 🛠️ Los 5 Módulos de Automatización Integrados

### 1. 📄 Módulo de Reservorio de Hojas de Vida (CVs)
* **Detección Automática**: Analiza documentos adjuntos (PDF, Word) e imágenes que contengan términos de postulación (`hoja de vida`, `hv`, `cv`, `curriculum`, `perfil profesional`, `postulacion`, `aspirante`).
* **Almacenamiento y Renombrado**: Guarda el archivo en `/public/downloads/hojas_de_vida/` con el nombre estructurado:  
  `HV_[Fecha]_[Remitente]_[Chat]_[NombreOriginal]`
* **Visualización**: Tab dedicado en la interfaz web con botón de descarga y apertura directa.

### 2. 📷 Módulo de Recopilación y Renombrado de Fotos
* **Descarga HD**: Intercepta imágenes enviadas en chats grupales o individuales.
* **Renombrado Estructurado**: `[Fecha]_[Grupo]_[Remitente]_[Descripcion]_[Timestamp].jpg`
* **Almacenamiento**: Guardado directo en `/public/downloads/photos/` con galería web dinámica.

### 3. 🔁 Módulo de Reenvío Inteligente entre Chats
* **Filtro por Etiquetas**: Escanea etiquetas clave como `#urgente`, `#gerencia`, `#reporte`.
* **Despacho Automático**: Formatea el mensaje indicando origen y remitente, y lo reenvía al grupo de destino configurado (ej: *Gerencia Ingelec*).

### 4. 📅 Módulo de Captura de Citas y Compromisos
* **Extracción Inteligente**: Reconoce fechas (`15 de agosto`, `de septiembre`...), compromisos (`recuerda`, `tenemos`, `reunión`, `concierto`, `boletas`, `viaje`).
* **Registro**: Lo añade a la bitácora de citas y opcionalmente lo envía a Google Sheets mediante Webhook.

### 5. 🧹 Módulo de Mantenimiento y Limpieza de Chats (>180 días)
* **Escaneo de Inactividad**: Endpoint `/api/cleanup-chats` que analiza la antigüedad de los grupos y chats.
* **Archivado Automático**: Archiva conversaciones sin uso por más de 6 meses para mantener limpia la aplicación de WhatsApp.

---

## 📁 Estructura del Proyecto

```
whatsapp-cloud-bot/
├── baileys_auth_info/        # Credenciales cifradas de la sesión de WhatsApp (auto-generado)
├── public/                    # Archivos estáticos de la interfaz web
│   ├── downloads/
│   │   ├── photos/           # Galería de imágenes descargadas
│   │   └── hojas_de_vida/    # Reservorio de Hojas de Vida (PDFs/Word)
│   ├── app.js                 # Lógica cliente Socket.io y actualización DOM
│   ├── index.html             # Dashboard Web (Pestañas y Monitoreo)
│   └── style.css              # Sistema de diseño Neo-Glassmorphic
├── Dockerfile                 # Configuración de compilación Node 20 para Render
├── package.json               # Dependencias del proyecto
├── server.js                  # Lógica principal del servidor, Baileys sockets y API REST
└── README.md                  # Guía técnica e instrucciones del desarrollador
```

---

## 🔑 Variables de Entorno (`.env`)

```env
PORT=3000
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
TARGET_FORWARD_CHAT_NAME=Gerencia Ingelec
```

---

## 🚀 Guía de Despliegue en Render.com

1. **Repositorio**: `https://github.com/carmelosanjuanesme-droid/whatsapp-cloud-bot.git`
2. **Crear Web Service en Render**:
   * **Environment**: `Docker`
   * **Region**: Oregon (US West) o Frankfurt
   * **Branch**: `main`
   * **Plan**: Free o Starter
3. **URL en Vivo**: `https://whatsapp-cloud-bot-z55t.onrender.com`

---

## 🤖 Prompt de Instrucción para Agentes (Claude Code / Cowork / Cursor)

Si vas a realizar mejoras o mantenimiento usando **Claude Code**, **Cowork**, **Cursor** u otro asistente de IA, copia y pega las siguientes instrucciones al iniciar la sesión:

```text
PROMPT DE CONTEXTO PARA CLAUDE CODE / COWORK / CURSOR:

Estás trabajando sobre el repositorio "whatsapp-cloud-bot". Este proyecto es un hub de automatización para WhatsApp 24/7 desplegado en Render.com sobre Node.js 20 + Docker + @whiskeysockets/baileys.

REGLAS DE DESARROLLO Y ARQUITECTURA:
1. MOTOR WHATSAPP:
   - Utiliza exclusivamente @whiskeysockets/baileys v6.7.5 con `fetchLatestBaileysVersion()` y `Browsers.ubuntu('Chrome')`.
   - NUNCA introduzcas Puppeteer, Chromium o whatsapp-web.js (superan el límite de 512MB RAM de Render).
   - Mantén la persistencia de autenticación en `baileys_auth_info` usando `useMultiFileAuthState`.

2. MÓDULOS ACTIVOS (server.js):
   - Módulo 1: Fotos (/public/downloads/photos/)
   - Módulo 2: Reenvío por etiquetas (#urgente, #gerencia, #reporte)
   - Módulo 3: Citas y recordatorios (Keywords de fechas y compromisos)
   - Módulo 4: Limpieza de chats (>180 días) via /api/cleanup-chats
   - Módulo 5: Hojas de Vida (/public/downloads/hojas_de_vida/)

3. INTERFAZ WEB (public/index.html & app.js):
   - Diseño Neo-Glassmorphism responsivo.
   - Sincronización en tiempo real via Socket.io + sondeo HTTP de respaldo cada 3s en /api/status.

4. FLUJO DE TRABAJO GIT:
   - Tras realizar modificaciones en server.js, public/ o Dockerfile:
     git add .
     git commit -m "Descripción clara del cambio"
     git push origin main
   - Render re-desplegará automáticamente en 30 segundos.
```
