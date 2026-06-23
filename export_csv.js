require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = '1X1_l8t8bw1G_CnYZArppGLvSEqAJxcmdDgULhPiMBTw';
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

async function exportSheetAsCSV() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH)).web;
  const oauth2Client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    credentials.redirect_uris[0]
  );

  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oauth2Client.setCredentials(token);

  // Refresh token if needed and save updated token
  oauth2Client.on('tokens', (tokens) => {
    const updated = { ...token, ...tokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated));
  });

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  // Get spreadsheet info (sheet names)
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetList = meta.data.sheets.map(s => s.properties.title);
  console.log('Hojas encontradas:', sheetList);

  for (const sheetName of sheetList) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetName,
    });

    const rows = res.data.values || [];
    const csvLines = rows.map(row =>
      row.map(cell => {
        const str = String(cell ?? '');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(',')
    );

    const safeName = sheetName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const outPath = path.join(__dirname, `${safeName}.csv`);
    fs.writeFileSync(outPath, csvLines.join('\n'), 'utf8');
    console.log(`Guardado: ${outPath} (${rows.length} filas)`);
  }
}

exportSheetAsCSV().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
