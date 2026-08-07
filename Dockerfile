FROM node:20-slim

# Directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias e instalar
COPY package.json ./
RUN npm install --production

# Copiar el resto del código
COPY . .

# Puerto expuesto para el servidor web y WebSockets
EXPOSE 3000

# Iniciar la aplicación
CMD ["npm", "start"]
