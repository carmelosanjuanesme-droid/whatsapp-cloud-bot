/**
 * Google Apps Script para recibir eventos del Bot Cloud de WhatsApp
 * 
 * Instrucciones:
 * 1. Abre tu hoja de cálculo en Google Sheets (ej. "Bitácora de Lluvias de Obra").
 * 2. Ve al menú superior: Extensiones -> Apps Script.
 * 3. Borra todo el código que aparece y pega este contenido.
 * 4. Haz clic en "Desplegar" -> "Nuevo despliegue".
 * 5. Selecciona el tipo: "Aplicación web".
 * 6. En "Quién tiene acceso", selecciona: "Cualquier persona" (Anyone).
 * 7. Haz clic en "Desplegar", autoriza los permisos y COPIA la URL de la aplicación web generada.
 * 8. Pega esa URL en la variable de entorno GOOGLE_SHEETS_WEBHOOK_URL de tu bot cloud (en Render/Railway).
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // Si la hoja está totalmente vacía, agregamos los encabezados automáticamente
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["FECHA", "HORA", "PROYECTO / GRUPO", "REMITENTE", "DETALLE DEL REPORTE"]);
      var headerRange = sheet.getRange(1, 1, 1, 5);
      headerRange.setBackground("#1F497D");
      headerRange.setFontColor("#FFFFFF");
      headerRange.setFontWeight("bold");
      headerRange.setHorizontalAlignment("center");
      sheet.setRowHeight(1, 30);
    }
    
    // Leer los datos del evento enviados por el bot en formato JSON
    var data = JSON.parse(e.postData.contents);
    
    var fecha = data.fecha || new Date().toISOString().split('T')[0];
    var hora = data.hora || new Date().toTimeString().split(' ')[0];
    var proyecto = data.proyecto || "Desconocido";
    var remitente = data.remitente || "Desconocido";
    var mensaje = data.mensaje || "";
    
    // Agregar la fila a la hoja de cálculo
    sheet.appendRow([fecha, hora, proyecto, remitente, mensaje]);
    
    // Formatear alineaciones de la última fila añadida
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, 2).setHorizontalAlignment("center");
    
    return ContentService.createTextOutput(JSON.stringify({"result": "success", "row": lastRow}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({"result": "error", "error": error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput("Servidor Google Apps Script activo y listo para recibir peticiones POST del Bot de WhatsApp.");
}
