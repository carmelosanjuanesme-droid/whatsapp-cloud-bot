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

    const hvsGrid = document.getElementById('hvsGrid');
    const hvCounter = document.getElementById('hvCounter');

    const remindersList = document.getElementById('remindersList');
    const reminderCounter = document.getElementById('reminderCounter');

    const forwardLogsList = document.getElementById('forwardLogsList');
    const cleanupLogsList = document.getElementById('cleanupLogsList');
    const btnRunCleanup = document.getElementById('btnRunCleanup');

    let totalEvents = 0;
    let totalPhotos = 0;
    let totalHvs = 0;
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
        const { status, qr, events, photos, hvs, reminders, forwardingRules, cleanupLog } = data;

        updateStatusUI(status, qr);

        if (events) renderEvents(events);
        if (photos) renderPhotos(photos);
        if (hvs) renderHvs(hvs);
        if (reminders) renderReminders(reminders);
        if (cleanupLog) renderCleanupLogs(cleanupLog);
    });

    // Verificación de estado de respaldo mediante HTTP cada 3 segundos
    async function checkStatusHTTP() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            if (data && data.status) {
                updateStatusUI(data.status, data.qr);
                if (data.events && data.events.length > 0) renderEvents(data.events);
                if (data.photos && data.photos.length > 0) renderPhotos(data.photos);
                if (data.hvs && data.hvs.length > 0) renderHvs(data.hvs);
                if (data.reminders && data.reminders.length > 0) renderReminders(data.reminders);
            }
        } catch (e) {}
    }

    checkStatusHTTP();
    setInterval(checkStatusHTTP, 3000);

    // Escuchar Eventos en Tiempo Real
    socket.on('new-event', (evt) => addEventToUI(evt, true));
    socket.on('new-photo', (photo) => addPhotoToUI(photo, true));
    socket.on('new-hv', (hv) => addHvToUI(hv, true));
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
                statusMessage.innerHTML = '✅ <strong>WhatsApp Conectado y Ejecutando los 4 Módulos.</strong>';
                statusMessage.style.display = 'block';
                statusMessage.style.color = '#10b981';
                break;

            case 'DESCONECTADO':
            default:
                statusDot.className = 'status-dot disconnected';
                statusBadge.textContent = 'Desconectado';
                statusBadge.style.color = '#ef4444';
                qrImage.style.display = 'none';
                spinner.style.display = 'block';
                statusMessage.textContent = 'Reconectando con WhatsApp...';
                statusMessage.style.display = 'block';
                statusMessage.style.color = '#ef4444';
                break;
        }
    }

    function renderEvents(events) {
        eventsList.innerHTML = '';
        totalEvents = events.length;
        if (eventCounter) eventCounter.textContent = `${totalEvents} eventos`;

        if (events.length === 0) {
            eventsList.innerHTML = '<div class="empty-state"><p>No hay eventos de lluvia registrados.</p></div>';
            return;
        }

        events.forEach(evt => addEventToUI(evt, false));
    }

    function addEventToUI(evt, isNew = false) {
        const item = document.createElement('div');
        item.className = `event-item ${isNew ? 'new-item' : ''}`;
        item.innerHTML = `
            <div class="event-meta">
                <span class="event-tag">🌧️ Clima</span>
                <span>📅 ${evt.fecha} ${evt.hora}</span>
                <span>📌 Chat: <strong>${evt.proyecto}</strong></span>
                <span>👤 ${evt.remitente}</span>
            </div>
            <div class="event-body">${evt.mensaje}</div>
        `;
        eventsList.prepend(item);
    }

    function renderPhotos(photos) {
        photosGrid.innerHTML = '';
        totalPhotos = photos.length;
        if (photoCounter) photoCounter.textContent = `${totalPhotos} fotos`;

        if (photos.length === 0) {
            photosGrid.innerHTML = '<div class="empty-state">No se han recibido fotografías en los grupos.</div>';
            return;
        }

        photos.forEach(photo => addPhotoToUI(photo, false));
    }

    function addPhotoToUI(photo, isNew = false) {
        const card = document.createElement('div');
        card.className = `photo-card ${isNew ? 'new-item' : ''}`;
        card.innerHTML = `
            <img src="${photo.url}" alt="${photo.descripcion}" loading="lazy">
            <div class="photo-info">
                <div class="photo-title">📁 ${photo.grupo}</div>
                <div class="photo-desc">💬 ${photo.descripcion}</div>
                <div class="photo-meta">
                    <span>👤 ${photo.remitente}</span>
                    <span>🕒 ${photo.fecha} ${photo.hora}</span>
                </div>
                <a href="${photo.url}" download="${photo.nombreArchivo}" class="btn-download">⬇️ Descargar Foto HD</a>
            </div>
        `;
        photosGrid.prepend(card);
    }

    // Renderizado de Hojas de Vida (CVs)
    function renderHvs(hvs) {
        hvsGrid.innerHTML = '';
        totalHvs = hvs.length;
        if (hvCounter) hvCounter.textContent = `${totalHvs} HVs`;

        if (hvs.length === 0) {
            hvsGrid.innerHTML = '<div class="empty-state">No se han recibido Hojas de Vida en tus chats por el momento.</div>';
            return;
        }

        hvs.forEach(hv => addHvToUI(hv, false));
    }

    function addHvToUI(hv, isNew = false) {
        const card = document.createElement('div');
        card.className = `photo-card hv-card ${isNew ? 'new-item' : ''}`;
        card.style.background = 'rgba(30, 41, 59, 0.7)';
        card.style.border = '1px solid rgba(148, 163, 184, 0.3)';
        card.style.padding = '16px';
        card.style.borderRadius = '12px';
        card.innerHTML = `
            <div style="font-size: 40px; text-align: center; margin-bottom: 10px;">📄</div>
            <div class="photo-info">
                <div class="photo-title" style="color: #60a5fa; font-weight: bold;">👤 ${hv.remitente}</div>
                <div class="photo-desc" style="color: #cbd5e1; font-size: 13px; margin: 6px 0;">💬 ${hv.descripcion}</div>
                <div class="photo-meta" style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #94a3b8;">
                    <span>📌 Chat: <strong>${hv.grupo}</strong></span>
                    <span>🕒 Fecha: ${hv.fecha} ${hv.hora}</span>
                    <span>📦 Archivo: ${hv.nombreOriginal} (${hv.tamano})</span>
                </div>
                <a href="${hv.url}" download="${hv.nombreArchivo}" target="_blank" class="btn-download" style="display: block; text-align: center; margin-top: 12px; background: #2563eb; color: #fff; text-decoration: none; padding: 8px 12px; border-radius: 8px; font-weight: 600;">📄 Abrir / Descargar Hoja de Vida</a>
            </div>
        `;
        hvsGrid.prepend(card);
    }

    function renderReminders(reminders) {
        remindersList.innerHTML = '';
        totalReminders = reminders.length;
        if (reminderCounter) reminderCounter.textContent = `${totalReminders} citas`;

        if (reminders.length === 0) {
            remindersList.innerHTML = '<div class="empty-state">No hay citas ni compromisos registrados por el momento.</div>';
            return;
        }

        reminders.forEach(rem => addReminderToUI(rem, false));
    }

    function addReminderToUI(rem, isNew = false) {
        const item = document.createElement('div');
        item.className = `event-item ${isNew ? 'new-item' : ''}`;
        item.innerHTML = `
            <div class="event-meta">
                <span class="event-tag" style="background: rgba(16, 185, 129, 0.2); color: #10b981;">📅 Cita Detectada</span>
                <span>🕒 Detectado: ${rem.fechaDetec}</span>
                <span>📌 Chat: <strong>${rem.origen}</strong></span>
                <span>👤 ${rem.remitente}</span>
            </div>
            <div class="event-body">${rem.mensaje}</div>
        `;
        remindersList.prepend(item);
    }

    function addForwardLogToUI(log) {
        const item = document.createElement('div');
        item.className = 'event-item new-item';
        item.innerHTML = `
            <div class="event-meta">
                <span class="event-tag" style="background: rgba(99, 102, 241, 0.2); color: #818cf8;">🔁 Reenviado</span>
                <span>🕒 ${log.hora}</span>
                <span>De: <strong>${log.origen}</strong></span>
                <span>Para: <strong>${log.destino}</strong></span>
            </div>
            <div class="event-body">${log.mensaje}</div>
        `;
        forwardLogsList.prepend(item);
    }

    function renderCleanupLogs(reports) {
        cleanupLogsList.innerHTML = '';
        reports.forEach(rep => {
            const item = document.createElement('div');
            item.className = 'event-item';
            item.innerHTML = `
                <div class="event-meta">
                    <span class="event-tag" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b;">🧹 Limpieza Ejecutada</span>
                    <span>🕒 ${new Date(rep.fechaEjecucion).toLocaleString()}</span>
                    <span>Escaneados: <strong>${rep.totalEscaneados}</strong></span>
                    <span>Archivados: <strong style="color: #10b981;">${rep.totalArchivados}</strong></span>
                </div>
                <div class="event-body" style="font-size: 12px; color: #94a3b8; max-height: 100px; overflow-y: auto;">
                    ${rep.detalles.map(d => `• ${d.nombre}: ${d.accion}`).join('<br>')}
                </div>
            `;
            cleanupLogsList.prepend(item);
        });
    }
});
