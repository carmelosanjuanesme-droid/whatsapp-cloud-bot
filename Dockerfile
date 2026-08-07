# Usar Node.js 20 sobre Debian Bookworm (ligero y compatible)
FROM node:20-bookworm-slim

# Instalar Chromium y dependencias del sistema necesarias para Puppeteer en Linux
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    pangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Configurar ruta del ejecutable de Chromium para whatsapp-web.js / Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Directorio de trabajo
WORKDIR /app

# Copiar configuración e instalar dependencias
COPY package.json ./
RUN npm install --production

# Copiar todo el código del proyecto
COPY . .

# Puerto expuesto para la app web
EXPOSE 3000

# Comando para iniciar el bot
CMD ["npm", "start"]
