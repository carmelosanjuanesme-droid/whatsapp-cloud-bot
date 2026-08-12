document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // Elementos de la UI Full Screen
    const statusDot = document.getElementById('statusDot');
    const statusBadgeText = document.getElementById('statusBadgeText');
    const qrImage = document.getElementById('qrImage');
    const spinner = document.getElementById('spinner');
    const statusMessage = document.getElementById('statusMessage');

    // KPI Contadores
    const kpiStatus = document.getElementById('kpiStatus');
    const kpiHvs = document.getElementById('kpiHvs');
    const kpiAudios = document.getElementById('kpiAudios');
    const kpiPhotos = document.getElementById('kpiPhotos');
    const kpiReminders = document.getElementById('kpiReminders');

    const photosGrid = document.getElementById('photosGrid');
    const photoCounter = document.getElementById('photoCounter');

    const hvsGrid = document.getElementById('hvsGrid');
    const hvCounter = document.getElementById('hvCounter');
    const hvSortSelect = document.getElementById('hvSortSelect');
    const hvFilterSelect = document.getElementById('hvFilterSelect');

    const audiosList = document.getElementById('audiosList');
    const audioCounter = document.getElementById('audioCounter');

    const btnSummaryDaily = document.getElementById('btnSummaryDaily');
    const btnSummaryWeekly = document.getElementById('btnSummaryWeekly');
    const summaryReportContainer = document.getElementById('summaryReportContainer');
    const summaryReportText = document.getElementById('summaryReportText');

    const remindersList = document.getElementById('remindersList');
    const reminderCounter = document.getElementById('reminderCounter');

    const forwardLogsList = document.getElementById('forwardLogsList');
    const cleanupLogsList = document.getElementById('cleanupLogsList');
    const btnRunCleanup = document.getElementById('btnRunCleanup');

    let totalPhotos = 0;
    let totalHvs = 0;
    let totalAudios = 0;
    let totalReminders = 0;
    let currentHvsList = [];

    // 1. MANEJO DE NAVEGACIÓN FULL SCREEN (SIDEBAR & BOTTOM NAV)
    const navItems = document.querySelectorAll('.nav-item, .bottom-nav-item');
    const hubPanes = document.querySelectorAll('.hub-pane');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetHub = item.getAttribute('data-hub');
            if (!targetHub) return;

            navItems.forEach(n => {
                if (n.getAttribute('data-hub') === targetHub) n.classList.add('active');
                else n.classList.remove('active');
            });

            hubPanes.forEach(pane => {
                if (pane.id === targetHub) pane.classList.add('active');
                else pane.classList.remove('active');
            });
        });
    });

    // 2. Escuchar Estado Inicial e Historial Completo
    socket.on('status-update', (data) => {
        const { status, qr, events, photos, hvs, audios, reminders, forwardingRules, cleanupLog, uptimeLogs } = data;

        updateStatusUI(status, qr);

        if (photos) renderPhotos(photos);
        if (hvs) {
            currentHvsList = hvs;
            renderHvs(currentHvsList);
        }
        if (audios) renderAudios(audios);
        if (reminders) renderReminders(reminders);
        if (cleanupLog) renderCleanupLogs(cleanupLog);
        if (uptimeLogs) renderUptimeLogs(uptimeLogs);
    });

    socket.on('uptime-log-new', (logItem) => {
        fetch('/api/uptime-logs').then(r => r.json()).then(d => {
            if (d && d.logs) renderUptimeLogs(d.logs);
        }).catch(() => {});
    });

    // Verificación de estado de respaldo mediante HTTP cada 3 segundos
    async function checkStatusHTTP() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            if (data && data.status) {
                updateStatusUI(data.status, data.qr);
                if (data.photos) renderPhotos(data.photos);
                if (data.hvs) {
                    currentHvsList = data.hvs;
                    renderHvs(currentHvsList);
                }
                if (data.audios) renderAudios(data.audios);
                if (data.reminders) renderReminders(data.reminders);
                if (data.uptimeLogs) renderUptimeLogs(data.uptimeLogs);
            }
        } catch (e) {}
    }

    checkStatusHTTP();
    setInterval(checkStatusHTTP, 3000);

    // Escuchar Eventos en Tiempo Real
    socket.on('new-photo', (photo) => addPhotoToUI(photo, true));
    socket.on('new-hv', (hv) => {
        currentHvsList.unshift(hv);
        renderHvs(currentHvsList);
    });
    socket.on('new-audio', (audio) => addAudioToUI(audio, true));
    socket.on('new-reminder', (rem) => addReminderToUI(rem, true));
    socket.on('new-log', (log) => addForwardLogToUI(log));
    socket.on('cleanup-completed', (report) => renderCleanupLogs([report]));

    // Filtros y Ordenamiento de Hojas de Vida
    if (hvSortSelect) hvSortSelect.addEventListener('change', () => renderHvs(currentHvsList));
    if (hvFilterSelect) hvFilterSelect.addEventListener('change', () => renderHvs(currentHvsList));

    const btnScanAllHvs = document.getElementById('btnScanAllHvs');
    if (btnScanAllHvs) {
        btnScanAllHvs.addEventListener('click', async () => {
            btnScanAllHvs.disabled = true;
            btnScanAllHvs.textContent = '⏳ Escaneando mensajes en todos tus chats...';

            try {
                const response = await fetch('/api/scan-history-hvs', { method: 'POST' });
                const data = await response.json();
                if (data.success) {
                    alert(`✅ Escaneo retroactivo completado: ${data.resultado.hvsEncontradas} Hojas de Vida rescatadas de ${data.resultado.chatsEscaneados} chats.`);
                } else {
                    alert(`⚠️ Error escaneando chats: ${data.error}`);
                }
            } catch (err) {
                alert(`Error en escaneo de chats: ${err.message}`);
            } finally {
                btnScanAllHvs.disabled = false;
                btnScanAllHvs.textContent = '🔍 Escanear Todos los Chats de WhatsApp (Buscar HVs Históricas)';
            }
        });
    }

    const btnExtractMariaHvs = document.getElementById('btnExtractMariaHvs');
    if (btnExtractMariaHvs) {
        btnExtractMariaHvs.addEventListener('click', async () => {
            btnExtractMariaHvs.disabled = true;
            btnExtractMariaHvs.textContent = '⏳ Extrayendo HVs de María Gestión Humana...';
            try {
                const res = await fetch('/api/extract-chat-hvs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chatName: 'maria' })
                });
                const d = await res.json();
                if (d.success) {
                    alert(`✅ Proceso completado para ${d.chatBuscado}:\n• Hojas de Vida detectadas: ${d.totalHvsDetectadas}\n• Archivos subidos a Google Drive: ${d.totalSubidasDrive}\nCarpeta destino en Drive: Hojas_de_Vida_Maria_Gestion_Humana`);
                } else {
                    alert(`⚠️ Error extrayendo HVs: ${d.error}`);
                }
            } catch (e) {
                alert(`Error de red: ${e.message}`);
            } finally {
                btnExtractMariaHvs.disabled = false;
                btnExtractMariaHvs.textContent = '👩‍💼 Extraer HVs de "María Gestión Humana" ➔ Drive';
            }
        });
    }

    const btnTestPing = document.getElementById('btnTestPing');
    const pingTestOutput = document.getElementById('pingTestOutput');
    if (btnTestPing && pingTestOutput) {
        btnTestPing.addEventListener('click', async () => {
            btnTestPing.disabled = true;
            btnTestPing.textContent = '⏳ Ejecutando diagnóstico de red...';
            pingTestOutput.style.display = 'block';
            pingTestOutput.innerHTML = 'Probando estado de servidores y base de datos...';
            try {
                const res = await fetch('/api/test-ping', { method: 'POST' });
                const d = await res.json();
                if (d.success) {
                    pingTestOutput.innerHTML = `
                        <strong>✅ Diagnóstico Exitoso (${d.timestamp}):</strong><br>
                        • Estado WhatsApp: <strong>${d.status}</strong><br>
                        • Base de Datos MongoDB: <strong>${d.mongoAtlas}</strong><br>
                        • Uso de RAM en Nube: <strong>${d.ramUsageMB}</strong><br>
                        • Contactos / Fotos HD / HVs: <strong>${d.contactsCount} chats / ${d.photosCount} fotos / ${d.hvsCount} HVs</strong>
                    `;
                } else {
                    pingTestOutput.innerHTML = `❌ Error en prueba: ${d.error}`;
                }
            } catch (e) {
                pingTestOutput.innerHTML = `❌ Error de red: ${e.message}`;
            } finally {
                btnTestPing.disabled = false;
                btnTestPing.textContent = '⚡ Probar Diagnóstico de Conexión en Vivo';
            }
        });
    }

    // 🔍 BUSCADOR UNIVERSAL DE CONTENIDOS EN TIEMPO REAL
    const globalSearchInput = document.getElementById('globalSearchInput');
    const btnGlobalSearch = document.getElementById('btnGlobalSearch');
    const searchResultsContainer = document.getElementById('searchResultsContainer');
    const searchResultsHeader = document.getElementById('searchResultsHeader');
    const searchResultsList = document.getElementById('searchResultsList');

    if (btnGlobalSearch && globalSearchInput) {
        const ejecutarBusqueda = async () => {
            const query = globalSearchInput.value.trim();
            if (!query) {
                searchResultsContainer.style.display = 'none';
                return;
            }

            btnGlobalSearch.textContent = '⏳ Buscando...';
            btnGlobalSearch.disabled = true;

            try {
                const res = await fetch(`/api/search-content?q=${encodeURIComponent(query)}`);
                const data = await res.json();

                if (data.success) {
                    searchResultsHeader.textContent = `🔍 ${data.total} resultados encontrados para "${query}":`;
                    searchResultsList.innerHTML = '';

                    if (data.resultados.length === 0) {
                        searchResultsList.innerHTML = '<div style="color: #94a3b8; font-size: 13px; padding: 8px;">No se encontraron mensajes, audios ni archivos con esa palabra clave.</div>';
                    } else {
                        data.resultados.forEach(item => {
                            const el = document.createElement('div');
                            el.className = 'event-card';
                            el.style.marginBottom = '8px';
                            el.innerHTML = `
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span class="badge" style="background: rgba(99, 102, 241, 0.2); color: #818cf8; font-size: 11px;">${item.tipo}</span>
                                    <span style="font-size: 11px; color: #64748b;">${item.fecha}</span>
                                </div>
                                <div style="font-size: 12px; color: #38bdf8; margin-top: 4px;">👤 <b>${item.remitente}</b> en <i>${item.chat}</i></div>
                                <div style="font-size: 13px; color: #f8fafc; margin-top: 4px;">"${item.contenido}"</div>
                                ${item.url ? `<a href="${item.url}" target="_blank" style="display: inline-block; margin-top: 6px; font-size: 12px; color: #34d399; text-decoration: underline;">📂 Abrir Archivo / Audio</a>` : ''}
                            `;
                            searchResultsList.appendChild(el);
                        });
                    }
                    searchResultsContainer.style.display = 'block';
                }
            } catch (err) {
                alert('Error realizando búsqueda de contenido.');
            } finally {
                btnGlobalSearch.textContent = '🔍 Buscar Contenido';
                btnGlobalSearch.disabled = false;
            }
        };

        btnGlobalSearch.addEventListener('click', ejecutarBusqueda);
        globalSearchInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') ejecutarBusqueda();
        });
    }

    // Generador de Resúmenes Periódicos
    if (btnSummaryDaily) btnSummaryDaily.addEventListener('click', () => fetchSummary('diario'));
    if (btnSummaryWeekly) btnSummaryWeekly.addEventListener('click', () => fetchSummary('semanal'));

    async function fetchSummary(periodo) {
        try {
            const response = await fetch(`/api/generate-summary?periodo=${periodo}`);
            const data = await response.json();
            if (data.success && data.resumen) {
                summaryReportText.textContent = data.resumen.resumenTexto;
                summaryReportContainer.style.display = 'block';
            }
        } catch (e) {
            alert('Error generando resumen de actividad.');
        }
    }

    // Ejecutar Limpieza de Chats Inactivos (>6 meses)
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

    // Resetear Sesión y Generar Nuevo QR Limpio
    const btnResetSession = document.getElementById('btnResetSession');
    if (btnResetSession) {
        btnResetSession.addEventListener('click', async () => {
            if (!confirm('¿Estás seguro de que deseas vaciar las credenciales anteriores y generar un nuevo código QR limpio?')) return;

            btnResetSession.disabled = true;
            btnResetSession.textContent = '⏳ Reseteando sesión y borrando credenciales...';

            try {
                const res = await fetch('/api/reset-session', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    alert('✅ Sesión reseteada. Generando nuevo código QR fresco...');
                } else {
                    alert(`⚠️ Error: ${data.error}`);
                }
            } catch (err) {
                alert(`Error al resetear sesión: ${err.message}`);
            } finally {
                btnResetSession.disabled = false;
                btnResetSession.textContent = '🔄 Resetear Sesión y Generar Nuevo QR Limpio';
            }
        });
    }

    // Funciones de Renderizado
    function updateStatusUI(status, qrDataUrl) {
        switch (status) {
            case 'ESPERANDO_QR':
            case 'INICIALIZANDO':
                if (qrDataUrl && qrImage) {
                    if (statusDot) statusDot.className = 'status-dot pulsing';
                    if (statusBadgeText) statusBadgeText.textContent = 'Esperando QR';
                    if (kpiStatus) kpiStatus.textContent = 'Esperando QR';
                    qrImage.src = qrDataUrl;
                    qrImage.style.display = 'block';
                    if (spinner) spinner.style.display = 'none';
                    if (statusMessage) statusMessage.style.display = 'none';
                } else {
                    if (statusDot) statusDot.className = 'status-dot pulsing';
                    if (statusBadgeText) statusBadgeText.textContent = 'Generando QR...';
                    if (kpiStatus) kpiStatus.textContent = 'Generando QR...';
                    if (qrImage) qrImage.style.display = 'none';
                    if (spinner) spinner.style.display = 'block';
                    if (statusMessage) {
                        statusMessage.textContent = 'Generando código QR de WhatsApp...';
                        statusMessage.style.display = 'block';
                        statusMessage.style.color = '#f59e0b';
                    }
                }
                break;

            case 'RESTAURANDO_SESION':
            case 'RECONECTANDO':
                if (statusDot) statusDot.className = 'status-dot pulsing';
                if (statusBadgeText) statusBadgeText.textContent = 'Autenticando Nube';
                if (kpiStatus) kpiStatus.textContent = 'Autenticando Nube';
                if (qrImage) qrImage.style.display = 'none';
                if (spinner) spinner.style.display = 'block';
                if (statusMessage) {
                    statusMessage.textContent = 'Autenticando sesión guardada en MongoDB Atlas...';
                    statusMessage.style.display = 'block';
                    statusMessage.style.color = '#60a5fa';
                }
                break;

            case 'AUTENTICADO':
            case 'CONECTADO_24_7':
                if (statusDot) statusDot.className = 'status-dot connected';
                if (statusBadgeText) statusBadgeText.textContent = 'Conectado 24/7';
                if (kpiStatus) kpiStatus.textContent = 'Conectado 24/7';
                if (qrImage) qrImage.style.display = 'none';
                if (spinner) spinner.style.display = 'none';
                if (statusMessage) {
                    statusMessage.innerHTML = '✅ <strong>WhatsApp Conectado y Ejecutando los Módulos de Automatización.</strong>';
                    statusMessage.style.display = 'block';
                    statusMessage.style.color = '#10b981';
                }
                break;

            case 'DESCONECTADO':
            default:
                if (statusDot) statusDot.className = 'status-dot disconnected';
                if (statusBadgeText) statusBadgeText.textContent = 'Desconectado';
                if (kpiStatus) kpiStatus.textContent = 'Desconectado';
                if (qrImage) qrImage.style.display = 'none';
                if (spinner) spinner.style.display = 'block';
                if (statusMessage) {
                    statusMessage.textContent = 'Reconectando con WhatsApp...';
                    statusMessage.style.display = 'block';
                    statusMessage.style.color = '#ef4444';
                }
                break;
        }
    }

    function renderPhotos(photos) {
        photosGrid.innerHTML = '';
        totalPhotos = photos.length;
        if (photoCounter) photoCounter.textContent = `${totalPhotos} fotos`;
        if (kpiPhotos) kpiPhotos.textContent = `${totalPhotos} Fotos`;

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
                <div class="photo-title" style="font-weight: bold; color: #f8fafc;">📁 ${photo.grupo}</div>
                <div class="photo-desc" style="color: #cbd5e1; font-size: 13px;">💬 ${photo.descripcion}</div>
                <div class="photo-meta" style="font-size: 12px; color: #94a3b8;">
                    <span>👤 ${photo.remitente}</span> • <span>🕒 ${photo.fecha} ${photo.hora}</span>
                </div>
                <a href="${photo.url}" download="${photo.nombreArchivo}" class="btn-download">⬇️ Descargar Foto HD</a>
            </div>
        `;
        photosGrid.prepend(card);
    }

    // Renderizado de Audios y Transcripciones
    function renderAudios(audios) {
        audiosList.innerHTML = '';
        totalAudios = audios.length;
        if (audioCounter) audioCounter.textContent = `${totalAudios} audios`;
        if (kpiAudios) kpiAudios.textContent = `${totalAudios} Audios`;

        if (audios.length === 0) {
            audiosList.innerHTML = '<div class="empty-state">No se han recibido notas de voz por el momento.</div>';
            return;
        }

        audios.forEach(audio => addAudioToUI(audio, false));
    }

    function addAudioToUI(audio, isNew = false) {
        const item = document.createElement('div');
        item.className = `event-item ${isNew ? 'new-item' : ''}`;
        item.style.background = 'rgba(30, 41, 59, 0.7)';
        item.style.borderLeft = '4px solid #a855f7';
        item.innerHTML = `
            <div class="event-meta">
                <span class="event-tag" style="background: rgba(168, 85, 247, 0.2); color: #c084fc;">🎙️ Transcripción IA</span>
                <span>🕒 ${audio.fecha} ${audio.hora}</span>
                <span>📌 Chat: <strong>${audio.grupo}</strong></span>
                <span>👤 ${audio.remitente}</span>
            </div>
            <div class="event-body" style="font-size: 14px; font-weight: 500; color: #f1f5f9; margin-top: 6px;">
                💬 "${audio.transcripcion}"
            </div>
            <audio controls src="${audio.url}" style="margin-top: 10px; width: 100%; height: 36px;"></audio>
        `;
        audiosList.prepend(item);
    }

    // Renderizado y Clasificación Avanzada de Hojas de Vida (CVs)
    function renderHvs(hvs) {
        hvsGrid.innerHTML = '';
        
        let filtered = [...hvs];

        const filterVal = hvFilterSelect ? hvFilterSelect.value : 'TODAS';
        if (filterVal !== 'TODAS') {
            filtered = filtered.filter(hv => hv.profesion === filterVal);
        }

        const sortVal = hvSortSelect ? hvSortSelect.value : 'profesion';
        if (sortVal === 'profesion') {
            filtered.sort((a, b) => (a.profesion || '').localeCompare(b.profesion || ''));
        } else if (sortVal === 'fecha') {
            filtered.sort((a, b) => new Date(b.fecha + ' ' + b.hora) - new Date(a.fecha + ' ' + a.hora));
        } else if (sortVal === 'alfabetico') {
            filtered.sort((a, b) => (a.remitente || '').localeCompare(b.remitente || ''));
        }

        totalHvs = filtered.length;
        if (hvCounter) hvCounter.textContent = `${totalHvs} HVs`;
        if (kpiHvs) kpiHvs.textContent = `${totalHvs} HVs`;

        if (filtered.length === 0) {
            hvsGrid.innerHTML = '<div class="empty-state">No hay Hojas de Vida registradas para esta categoría.</div>';
            return;
        }

        filtered.forEach(hv => addHvToUI(hv, false));
    }

    function addHvToUI(hv, isNew = false) {
        const card = document.createElement('div');
        card.className = `photo-card hv-card ${isNew ? 'new-item' : ''}`;
        card.style.background = 'rgba(30, 41, 59, 0.7)';
        card.style.border = '1px solid rgba(148, 163, 184, 0.3)';
        card.style.padding = '16px';
        card.style.borderRadius = '12px';
        card.innerHTML = `
            <div style="font-size: 32px; text-align: center; margin-bottom: 8px;">📄</div>
            <div class="photo-info">
                <div style="font-size: 11px; font-weight: bold; padding: 4px 8px; background: rgba(59, 130, 246, 0.2); color: #60a5fa; border-radius: 6px; display: inline-block; margin-bottom: 8px;">
                    ${hv.profesion || '📋 General'}
                </div>
                <div class="photo-title" style="color: #f8fafc; font-weight: 700; font-size: 16px;">👤 ${hv.remitente}</div>
                <div class="photo-desc" style="color: #cbd5e1; font-size: 13px; margin: 6px 0;">💬 ${hv.descripcion}</div>
                <div class="photo-meta" style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #94a3b8; background: rgba(15, 23, 42, 0.5); padding: 8px; border-radius: 6px; margin: 8px 0;">
                    <span>📌 Chat: <strong>${hv.grupo}</strong></span>
                    <span>🕒 Fecha: ${hv.fecha} ${hv.hora}</span>
                    <span>📦 Archivo: ${hv.nombreOriginal} (${hv.tamano})</span>
                </div>
                <a href="${hv.url}" download="${hv.nombreArchivo}" target="_blank" class="btn-download" style="display: block; text-align: center; margin-top: 10px; background: #2563eb; color: #fff; text-decoration: none; padding: 8px 12px; border-radius: 8px; font-weight: 600;">📄 Abrir / Descargar Hoja de Vida</a>
            </div>
        `;
        hvsGrid.appendChild(card);
    }

    function renderReminders(reminders) {
        remindersList.innerHTML = '';
        totalReminders = reminders.length;
        if (reminderCounter) reminderCounter.textContent = `${totalReminders} citas`;
        if (kpiReminders) kpiReminders.textContent = `${totalReminders} Citas`;

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

    function renderUptimeLogs(logs) {
        const list = document.getElementById('uptimeLogsList');
        if (!list) return;
        if (!logs || logs.length === 0) {
            list.innerHTML = '<div class="empty-state">No hay registros de conexión aún.</div>';
            return;
        }
        list.innerHTML = logs.map(l => {
            let badgeColor = '#10b981';
            let bgStyle = 'rgba(16, 185, 129, 0.15)';
            if (l.status === 'ESPERANDO_QR') {
                badgeColor = '#f59e0b';
                bgStyle = 'rgba(245, 158, 11, 0.15)';
            } else if (l.status === 'RECONECTANDO') {
                badgeColor = '#3b82f6';
                bgStyle = 'rgba(59, 130, 246, 0.15)';
            } else if (l.status === 'DESCONECTADO') {
                badgeColor = '#ef4444';
                bgStyle = 'rgba(239, 68, 68, 0.15)';
            }
            return `
                <div class="event-item" style="border-left: 3px solid ${badgeColor}; padding: 10px 12px; margin-bottom: 8px; background: rgba(255,255,255,0.02); border-radius: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="font-size: 11px; color: rgba(255,255,255,0.5);">${l.fecha || ''} ${l.hora || ''}</span>
                        <span style="font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: ${bgStyle}; color: ${badgeColor};">${l.status || 'OK'}</span>
                    </div>
                    <div style="font-size: 12px; color: #e2e8f0; font-weight: 500;">${l.evento || ''}</div>
                    ${l.detalle ? `<div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 2px;">${l.detalle}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    // 🤖 EJECUTAR COMANDOS AGÉNTICOS DE IA DESDE LA WEB
    const btnExecuteAiCommand = document.getElementById('btnExecuteAiCommand');
    const aiCommandInput = document.getElementById('aiCommandInput');
    const aiChatTargetInput = document.getElementById('aiChatTargetInput');
    const aiCommandOutputContainer = document.getElementById('aiCommandOutputContainer');
    const aiCommandOutputText = document.getElementById('aiCommandOutputText');

    if (btnExecuteAiCommand && aiCommandInput) {
        btnExecuteAiCommand.addEventListener('click', async () => {
            const command = aiCommandInput.value.trim();
            const chatTarget = aiChatTargetInput ? aiChatTargetInput.value.trim() : '';

            if (!command) {
                alert('Por favor escribe una orden o comando para la IA');
                return;
            }

            btnExecuteAiCommand.disabled = true;
            btnExecuteAiCommand.innerHTML = '⏳ Procesando con IA...';
            if (aiCommandOutputContainer) aiCommandOutputContainer.style.display = 'block';
            if (aiCommandOutputText) aiCommandOutputText.textContent = '🧠 Analizando chats, Hojas de Vida y contenidos con Inteligencia Artificial... Por favor espera...';

            try {
                const res = await fetch('/api/execute-ai-command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command, chatName: chatTarget })
                });

                const data = await res.json();
                if (data.success) {
                    if (aiCommandOutputText) {
                        aiCommandOutputText.textContent = data.procesado || 'Comando ejecutado con éxito.';
                    }
                } else {
                    if (aiCommandOutputText) {
                        aiCommandOutputText.textContent = '❌ Error ejecutando comando: ' + (data.error || 'Desconocido');
                    }
                }
            } catch (err) {
                if (aiCommandOutputText) {
                    aiCommandOutputText.textContent = '❌ Error de conexión: ' + err.message;
                }
            } finally {
                btnExecuteAiCommand.disabled = false;
                btnExecuteAiCommand.innerHTML = '⚡ Ejecutar Orden de IA';
            }
        });
    }

    // 👥 CREAR GRUPO DE WHATSAPP DESDE WORD O LISTA DE NÚMEROS
    const btnCreateGroupFromWeb = document.getElementById('btnCreateGroupFromWeb');
    const newGroupNameInput = document.getElementById('newGroupNameInput');
    const docxGroupFileInput = document.getElementById('docxGroupFileInput');
    const numbersListTextarea = document.getElementById('numbersListTextarea');
    const createGroupOutputContainer = document.getElementById('createGroupOutputContainer');
    const createGroupOutputText = document.getElementById('createGroupOutputText');

    if (btnCreateGroupFromWeb) {
        btnCreateGroupFromWeb.addEventListener('click', async () => {
            const groupName = newGroupNameInput ? newGroupNameInput.value.trim() : '';
            const rawNumbers = numbersListTextarea ? numbersListTextarea.value.trim() : '';
            const file = docxGroupFileInput && docxGroupFileInput.files[0] ? docxGroupFileInput.files[0] : null;

            if (!groupName) {
                alert('Por favor ingresa un Nombre para el Nuevo Grupo');
                return;
            }

            if (!rawNumbers && !file) {
                alert('Por favor selecciona un archivo de Word (.docx) o pega una lista de números de teléfono.');
                return;
            }

            btnCreateGroupFromWeb.disabled = true;
            btnCreateGroupFromWeb.innerHTML = '⏳ Procesando documento y creando grupo en WhatsApp...';
            if (createGroupOutputContainer) createGroupOutputContainer.style.display = 'block';
            if (createGroupOutputText) createGroupOutputText.textContent = '👥 Extrayendo contactos y creando grupo en WhatsApp... Por favor espera...';

            let fileDataBase64 = null;
            if (file) {
                fileDataBase64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result.split(',')[1]);
                    reader.readAsDataURL(file);
                });
            }

            try {
                const res = await fetch('/api/create-group-from-list', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        groupName: groupName,
                        numbersList: rawNumbers,
                        fileData: fileDataBase64
                    })
                });

                const data = await res.json();
                if (data.success) {
                    if (createGroupOutputText) {
                        createGroupOutputText.textContent = data.reporte || 'Grupo creado con éxito.';
                    }
                } else {
                    if (createGroupOutputText) {
                        createGroupOutputText.textContent = '❌ Error creando grupo: ' + (data.error || 'Desconocido');
                    }
                }
            } catch (err) {
                if (createGroupOutputText) {
                    createGroupOutputText.textContent = '❌ Error de red: ' + err.message;
                }
            } finally {
                btnCreateGroupFromWeb.disabled = false;
                btnCreateGroupFromWeb.innerHTML = '👥 Crear Grupo de WhatsApp y Generar Enlace de Invitación';
            }
        });
    }
});
