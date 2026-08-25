# 🚀 Guía Oficial de Instalación 24/7 en Servidor de la Empresa

Esta guía permite desplegar **WhatsApp Cloud 24/7** en un servidor propio de la empresa (Windows Server, Ubuntu, Debian o máquina dedicada). 

Al ejecutarse en un servidor propio con **disco físico permanente**, el sistema **JAMÁS borra la sesión de WhatsApp, NUNCA entra en reposo y NO vuelve a pedir código QR tras reinicios del servidor**.

---

## 🛠️ Requisitos Previos

1. **Node.js (v18.x o superior)** instalado en el servidor.
   - *Windows Server*: Descargar instalador `.msi` desde [nodejs.org](https://nodejs.org).
   - *Linux (Ubuntu/Debian)*: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs`
2. **Git** instalado.

---

## 📋 Pasos de Instalación (En 3 Pasos)

### Paso 1: Clonar el Repositorio en el Servidor
Abre la consola o terminal del servidor y ejecuta:

```bash
git clone https://github.com/carmelosanjuanesme-droid/whatsapp-cloud-bot.git
cd whatsapp-cloud-bot
npm install
```

---

### Paso 2: Crear el Archivo de Variables `.env`
Crea un archivo llamado `.env` en la raíz del proyecto (`whatsapp-cloud-bot/.env`) con las credenciales de la empresa:

```env
PORT=3000
GROQ_API_KEY=tu_api_key_de_groq_aqui
MONGODB_URI=tu_mongodb_uri_opcional_aqui
TARGET_FORWARD_CHAT_NAME=Gerencia Ingelec
GOOGLE_SHEETS_WEBHOOK_URL=
```

---

### Paso 3: Configurar Ejecución 24/7 Ininterrumpida con PM2 (Process Manager)

Para garantizar que el bot se ejecute continuamente en segundo plano y se **reinicie automáticamente si el servidor de la empresa se apaga o reinicia por mantenimiento**:

1. **Instalar PM2 globalmente**:
   ```bash
   npm install -g pm2
   ```

2. **Iniciar la Aplicación con PM2**:
   ```bash
   pm2 start server.js --name "whatsapp-bot"
   ```

3. **Guardar el estado y configurar arranque automático del sistema**:
   - En **Linux**:
     ```bash
     pm2 save
     pm2 startup
     ```
   - En **Windows Server** (opcional con `pm2-windows-service`):
     ```bash
     npm install -g pm2-windows-service
     pm2-service-install -n PM2
     pm2 save
     ```

---

## 🌐 Acceso al Dashboard en la Red de la Empresa

Una vez iniciado PM2, la aplicación estará disponible en la red interna o dominio de la empresa:

- **Localmente**: `http://localhost:3000`
- **Desde la red corporativa**: `http://<IP_DEL_SERVIDOR>:3000` (Ejemplo: `http://192.168.1.50:3000`)

---

## 🛡️ ¿Por qué este despliegue es 100% Indestructible?

1. **Disco Físico Permanente**: La carpeta de llaves `baileys_auth_info` vive en el disco duro físico del servidor de la empresa. **Nunca se borra ni se resetea**.
2. **Cero Reposo / Cero Sleep**: El servidor de la empresa no se apaga tras 15 minutos de inactividad.
3. **Reconexión Instantánea en 0ms**: Si el servidor de la empresa se reinicia por actualización del sistema operativo, PM2 inicia el bot, Baileys lee las llaves físicas locales en 0ms y se conecta inmediatamente en **`🟢 CONECTADO_24_7`** **sin pedir código QR jamás**.
