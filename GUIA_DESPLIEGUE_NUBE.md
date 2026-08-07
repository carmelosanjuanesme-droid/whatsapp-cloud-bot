# Guía Completa: Despliegue del Bot de WhatsApp 24/7 en la Nube (para iPhone)

Esta guía te explica cómo tener tu bot funcionando **gratis las 24 horas del día en la nube** sin necesidad de dejar tu computadora encendida.

---

## 📊 PASO 1: Configurar la Hoja de Google Sheets (2 Minutos)

1. Abre tu navegador e ingresa a [Google Sheets](https://sheets.google.com). Crea una hoja de cálculo nueva y ponle de nombre `Bitacora de Lluvias de Obra`.
2. En el menú superior de la hoja, ve a: **Extensiones** ➔ **Apps Script**.
3. Borra cualquier código que aparezca y pega el contenido del archivo **[GoogleAppsScript.js](file:///C:/Users/Carmelo/.gemini/antigravity/scratch/whatsapp-cloud-bot/GoogleAppsScript.js)**.
4. Arriba a la derecha, haz clic en el botón azul **Desplegar** ➔ **Nuevo despliegue**.
5. Haz clic en el icono de engranaje ⚙️ y selecciona **Aplicación web**.
6. Configura los campos:
   * **Descripción**: `Webhook WhatsApp Cloud`
   * **Quién tiene acceso**: Cambia a **Cualquier persona** (Anyone).
7. Haz clic en **Desplegar**, otorga los permisos necesarios con tu cuenta de Google y **COPIA LA URL DE LA APLICACIÓN WEB GENERADA** (Termina en `/exec`).

---

## ☁️ PASO 2: Desplegar el Bot Gratis en Render.com (3 Minutos)

1. Crea una cuenta gratuita en [Render.com](https://render.com) (puedes registrarte con tu correo o cuenta de GitHub).
2. En el panel principal de Render, haz clic en **New +** ➔ **Web Service**.
3. Selecciona **Build and deploy from a Git repository** (o conecta con tu repositorio si subiste esta carpeta a GitHub).
4. Configura los datos del servicio:
   * **Name**: `bot-whatsapp-ingelec` (o el nombre que prefieras).
   * **Environment**: `Docker`
   * **Instance Type**: `Free`
5. En la sección **Environment Variables** (Variables de entorno), añade:
   * **Key**: `GOOGLE_SHEETS_WEBHOOK_URL`
   * **Value**: Pegas la URL de Google Apps Script que copiaste en el Paso 1.
6. Haz clic en **Create Web Service**.

 Render compilará el contenedor Docker e iniciará tu bot en cuestión de 2 a 3 minutos. Te dará una URL pública como: `https://bot-whatsapp-ingelec.onrender.com`.

---

## 📱 PASO 3: Vincular tu iPhone (1 Minuto)

1. En tu iPhone, abre Safari o Chrome e ingresa a la URL que te dio Render (ej. `https://bot-whatsapp-ingelec.onrender.com`).
2. Verás el Dashboard en vivo y el **Código QR**.
3. En tu iPhone, abre la app de **WhatsApp** ➔ **Configuración** ➔ **Dispositivos vinculados** ➔ **Vincular dispositivo**.
4. Escanea el código QR de la pantalla.

¡Listo! El bot quedará **vinculado y escuchando 24/7 en la nube**. Cada vez que cualquier persona en tus grupos de obra escriba *"lluvia"*, *"llovizna"*, *"tiempo muerto"* o *"mixer"*, el evento se insertará automáticamente en tu hoja de Google Sheets y podrás ver la bitácora actualizada desde la app de Google Sheets en tu iPhone sin necesidad de tener tu PC encendida.
