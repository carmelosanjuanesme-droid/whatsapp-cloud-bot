document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // Elementos de la UI
    const statusDot = document.getElementById('statusDot');
    const statusBadge = document.getElementById('statusBadge');
    const qrImage = document.getElementById('qrImage');
    const spinner = document.getElementById('spinner');
    const statusMessage = document.getElementById('statusMessage');

    const eventsList = document.getElementById('eventsList');
    const eventCounter = document.getElementById('eventCounter');

    const photosGrid = document.getElementById('photosGrid');
    const photoCounter = document.getElementById('photoCounter');

    const remindersList = document.getElementById('remindersList');
    const reminderCounter = document.getElementById('reminderCounter');

    const forwardLogsList = document.getElementById('forwardLogsList');
    const cleanupLogsList = document.getElementById('cleanupLogsList');
    const btnRunCleanup = document.getElementById('btnRunCleanup');

    let totalEvents = 0;
    let totalPhotos = 0;
    let totalReminders = 0;

    // 1. Manejo de Pestañas (Nav Tabs)
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPane = document.getElementById(btn.dataset.tab);
            if (targetPane) targetPane.classList.add('active');
        });
    });

    // 2. Escuchar Estado Inicial e Historial Completo
    socket.on('status-update', (data) => {
        const { status, qr, events, photos, reminders, forwardingRules, cleanupLog } = data;

        updateStatusUI(status, qr);

        if (events) renderEvents(events);
        if (photos) renderPhotos(photos);
        if (reminders) renderReminders(reminders);
        if (cleanupLog) renderCleanupLogs(cleanupLog);
    });

    // Escuchar Eventos en Tiempo Real
    socket.on('new-event', (evt) => addEventToUI(evt, true));
    socket.on('new-photo', (photo) => addPhotoToUI(photo, true));
    socket.on('new-reminder', (rem) => addReminderToUI(rem, true));
    socket.on('new-log', (log) => addForwardLogToUI(log));
    socket.on('cleanup-completed', (report) => renderCleanupLogs([report]));

    // 3. Ejecutar Limpieza de Chats Inactivos (>6 meses)
    if (btnRunCleanup) {
        btnRunCleanup.addEventListener('click', async () => {
            btnRunCleanup.disabled = true;
            btnRunCleanup.textContent = '⏳ Escaneando y archivando chats inactivos...';

            try {
                const response = await fetch('/api/cleanup-chats', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dias: 180 })
                });

                const data = await response.json();
                if (data.success) {
                    alert(`✅ Limpieza completada: ${data.resultado.totalArchivados} chats archivados por llevar más de 6 meses inactivos.`);
                } else {
                    alert(`⚠️ Error al ejecutar limpieza: ${data.error}`);
                }
            } catch (err) {
                alert(`Error conectando al servidor: ${err.message}`);
            } finally {
                btnRunCleanup.disabled = false;
                btnRunCleanup.textContent = '🚀 Ejecutar Limpieza de Chats Inactivos (>180 días)';
            }
        });
    }

    // 4. Funciones de Renderizado
    function updateStatusUI(status, qrDataUrl) {
        switch (status) {
            case 'ESPERANDO_QR':
                statusDot.className = 'status-dot pulsing';
                statusBadge.textContent = 'Esperando Código QR';
                statusBadge.style.color = '#f59e0b';
                if (qrDataUrl) {
                    qrImage.src = qrDataUrl;
                    qrImage.style.display = 'block';
                    spinner.style.display = 'none';
                    statusMessage.style.display = 'none';
                }
                break;

            case 'AUTENTICADO':
            case 'CONECTADO_24_7':
                statusDot.className = 'status-dot connected';
                statusBadge.textContent = 'Conectado 24/7 en la Nube';
                statusBadge.style.color = '#10b981';
                qrImage.style.display = 'none';
                spinner.style.display = 'none';
                statusMessage.textContent = '✅ WhatsApp Conectado y Ejecutando los 4 Módulos.';
                statusMessage.style.display = 'block';
                statusMessage.style.color = '#10b981';
                break;

            case 'DESCONECTADO':
                statusDot.className = 'status-dot';
                statusBadge.textContent = 'Desconectado';
                statusBadge.style.color = '#ef4444';
                qrImage.style.display = 'none';
                spinner.style.display = 'block';
                statusMessage.textContent = 'Reintentando conexión...';
                statusMessage.style.display = 'block';
                break;
        }
    }

    function renderEvents(events) {
        eventsList.innerHTML = '';
        totalEvents = events.length;
        eventCounter.textContent = `${totalEvents} eventos`;
        if (events.length === 0) {
            eventsList.innerHTML = '<div class="empty-state">No hay eventos de lluvia registrados.</div>';
            return;
        }
        events.forEach(evt => addEventToUI(evt, false));
    }

    function addEventToUI(evt, isNew) {
        const item = document.createElement('div');
        item.className = 'event-item';
        item.innerHTML = `
            <div class="event-meta">
                <span>📅 ${evt.fecha} - ⏰ ${evt.hora}</span>
                <span>👤 ${escapeHtml(evt.remitente)}</span>
            </div>
            <div class="event-project">📌 ${escapeHtml(evt.proyecto)}</div>
            <div class="event-text">"${escapeHtml(evt.mensaje)}"</div>
        `;
        if (isNew) {
            eventsList.insertBefore(item, eventsList.firstChild);
            totalEvents++;
            eventCounter.textContent = `${totalEvents} eventos`;
        } else {
            eventsList.appendChild(item);
        }
    }

    function renderPhotos(photos) {
        photosGrid.innerHTML = '';
        totalPhotos = photos.length;
        photoCounter.textContent = `${totalPhotos} fotos`;
        if (photos.length === 0) {
            photosGrid.innerHTML = '<div class="empty-state">No se han recibido fotografías aún.</div>';
            return;
        }
        photos.forEach(p => addPhotoToUI(p, false));
    }

    function addPhotoToUI(photo, isNew) {
        const card = document.createElement('div');
        card.className = 'photo-card';
        card.innerHTML = `
            <img src="${photo.url}" alt="Foto de Obra" loading="lazy" onerror="this.src='https://via.placeholder.com/300x200?text=Foto+Procesada'">
            <div class="photo-info">
                <span class="photo-title">📌 ${escapeHtml(photo.proyecto)}</span>
                <span class="photo-desc">👤 ${escapeHtml(photo.remitente)}</span>
                <span class="photo-desc">📅 ${photo.fecha} ${photo.hora}</span>
                <span class="photo-desc">💬 "${escapeHtml(photo.descripcion)}"</span>
            </div>
        `;
        if (isNew) {
            photosGrid.insertBefore(card, photosGrid.firstChild);
            totalPhotos++;
            photoCounter.textContent = `${totalPhotos} fotos`;
        } else {
            photosGrid.appendChild(card);
        }
    }

    function renderReminders(reminders) {
        remindersList.innerHTML = '';
        totalReminders = reminders.length;
        reminderCounter.textContent = `${totalReminders} citas`;
        if (reminders.length === 0) {
            remindersList.innerHTML = '<div class="empty-state">No se han detectado citas o compromisos.</div>';
            return;
        }
        reminders.forEach(r => addReminderToUI(r, false));
    }

    function addReminderToUI(rem, isNew) {
        const item = document.createElement('div');
        item.className = 'event-item';
        item.innerHTML = `
            <div class="event-meta">
                <span>📅 Capturado el ${rem.fechaCaptura}</span>
                <span>👤 ${escapeHtml(rem.remitente)}</span>
            </div>
            <div class="event-project">📌 ${escapeHtml(rem.proyecto)}</div>
            <div class="event-text">💬 "${escapeHtml(rem.detalle)}"</div>
        `;
        if (isNew) {
            remindersList.insertBefore(item, remindersList.firstChild);
            totalReminders++;
            reminderCounter.textContent = `${totalReminders} citas`;
        } else {
            remindersList.appendChild(item);
        }
    }

    function addForwardLogToUI(log) {
        const item = document.createElement('div');
        item.className = 'event-item';
        item.innerHTML = `
            <div class="event-meta">
                <span>🔁 Reenviado de: ${escapeHtml(log.origen)}</span>
                <span>➔ Hacia: ${escapeHtml(log.destino)}</span>
            </div>
            <div class="event-text">"${escapeHtml(log.mensaje)}"</div>
        `;
        forwardLogsList.insertBefore(item, forwardLogsList.firstChild);
    }

    function renderCleanupLogs(logs) {
        if (!logs || logs.length === 0) return;
        cleanupLogsList.innerHTML = '';
        logs.forEach(report => {
            const item = document.createElement('div');
            item.className = 'event-item';
            item.innerHTML = `
                <div class="event-meta">
                    <span>🧹 Escaneo del ${new Date(report.fechaEjecucion).toLocaleString()}</span>
                    <span>📦 Archivados: ${report.totalArchivados} de ${report.totalEscaneados} chats</span>
                </div>
                <div class="event-text">
                    ${report.detalles.length === 0 ? 'No se encontraron chats con más de 6 meses de inactividad.' :
                      report.detalles.map(d => `• <strong>${escapeHtml(d.chat)}</strong>: ${d.diasInactivo} días inactivo (Archivado)`).join('<br>')}
                </div>
            `;
            cleanupLogsList.appendChild(item);
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;');
    }
});
