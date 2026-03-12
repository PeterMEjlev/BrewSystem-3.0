/**
 * Google Apps Script — Keg Updater
 *
 * Paste this into: Extensions → Apps Script in your Keg Status spreadsheet.
 * Then: Deploy → New deployment → Web app
 *   - Execute as: Me
 *   - Who has access: Anyone
 * Copy the deployment URL and paste it into APPS_SCRIPT_URL in ToolsPage.jsx.
 *
 * Expects a JSON POST body with:
 *   { number, contents, date, note, volume, abv }
 * where `number` is the keg number used to find the correct row.
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var kegNumber = String(data.number).trim();

    if (!kegNumber) {
      return response({ error: 'Missing keg number' }, 400);
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1')
              || SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var rows = sheet.getDataRange().getValues();

    // Find the row where column B (index 1) matches the keg number.
    // Data starts at row 3 (index 2) — row 1 is blank, row 2 is headers.
    var targetRow = -1;
    for (var i = 2; i < rows.length; i++) {
      if (String(rows[i][1]).trim() === kegNumber) {
        targetRow = i + 1; // 1-based row index for the sheet API
        break;
      }
    }

    if (targetRow === -1) {
      return response({ error: 'Keg #' + kegNumber + ' not found' }, 404);
    }

    // Update columns C–G (indices 3–7 in 1-based)
    // C = Contents, D = Date, E = Note, F = Volume, G = ABV
    if (data.contents !== undefined) sheet.getRange(targetRow, 3).setValue(data.contents);
    if (data.date     !== undefined) sheet.getRange(targetRow, 4).setValue(data.date);
    if (data.note     !== undefined) sheet.getRange(targetRow, 5).setValue(data.note);
    if (data.volume   !== undefined) sheet.getRange(targetRow, 6).setValue(data.volume);
    if (data.abv      !== undefined) sheet.getRange(targetRow, 7).setValue(data.abv);

    SpreadsheetApp.flush();

    return response({ success: true, row: targetRow });
  } catch (err) {
    return response({ error: err.message }, 500);
  }
}

function response(body, code) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

// Allow CORS preflight (browsers send OPTIONS before POST)
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', info: 'Use POST to update kegs.' }))
    .setMimeType(ContentService.MimeType.JSON);
}
