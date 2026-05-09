import path from 'node:path';
import {
  openAttachedPage,
  pauseLikeHuman,
  waitForAppShell,
  waitForVisible,
  minimalDelay,
  dismissPopups,
} from '../common.js';

const SHEETS_HOME = 'https://sheets.google.com/';
const SHEETS_NEW  = 'https://sheets.new/';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function openSheets(attachedBrowser, url = SHEETS_HOME) {
  const page = await openAttachedPage(attachedBrowser, url, { platform: 'sheets' });
  await waitForAppShell(page, 'sheets');
  await dismissPopups(page);
  return page;
}

// Wait for the Sheets editor to be ready (the formula bar or a cell)
async function waitForEditor(page, timeoutMs = 20000) {
  const ready = await waitForVisible(page, [
    '#t-formula-bar-input-container',
    '.waffle-name-box',
    '.cell-input',
    '[aria-label="Name Box"]',
    '.docs-sheet-tab',
  ], timeoutMs);
  if (!ready) throw new Error('Google Sheets editor did not load. Make sure you are logged in to Google.');
  return ready;
}

// Click a specific cell (e.g. 'A1', 'B2')
async function clickCell(page, cellRef) {
  // Use the Name Box to navigate directly
  const nameBox = await waitForVisible(page, [
    '.waffle-name-box input',
    '#t-name-box-input',
    '[aria-label="Name Box"] input',
    'input[aria-label="Cell Reference"]',
  ], 5000);
  if (nameBox) {
    await nameBox.click({ clickCount: 3 });
    await page.keyboard.type(cellRef);
    await page.keyboard.press('Enter');
    await minimalDelay(400);
    return true;
  }
  return false;
}

// Type value into the currently active cell
async function typeInCell(page, value) {
  await page.keyboard.type(String(value), { delay: 10 });
  await page.keyboard.press('Tab'); // Move to next cell
  await minimalDelay(100);
}

// Fill a 2D array of data starting at startCell (e.g. 'A1')
async function fillData(page, data, startCell = 'A1') {
  if (!Array.isArray(data) || data.length === 0) return;

  // Navigate to start cell
  await clickCell(page, startCell);
  await minimalDelay(200);

  for (const row of data) {
    const values = Array.isArray(row) ? row : [row];
    for (let i = 0; i < values.length; i++) {
      await typeInCell(page, values[i]);
    }
    // Move to beginning of next row
    await page.keyboard.press('Enter');
    await minimalDelay(100);
  }
}

// Save the spreadsheet with Ctrl+S
async function saveSheet(page) {
  await page.keyboard.press('Control+S');
  await minimalDelay(1000);
}

// Get the current spreadsheet URL (to return as result)
async function getSheetUrl(page) {
  return page.url();
}

// Rename the active sheet tab
async function renameSheet(page, name) {
  // Double click the sheet tab
  const tab = page.locator('.docs-sheet-tab.docs-sheet-active-tab, .goog-inline-block.docs-sheet-tab').first();
  if (await tab.count() > 0) {
    await tab.dblclick().catch(() => {});
    await minimalDelay(500);
    await page.keyboard.selectAll();
    await page.keyboard.type(name, { delay: 30 });
    await page.keyboard.press('Enter');
    await minimalDelay(400);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const gsheetsHandler = {
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;

    // ── create_sheet — open sheets.new and fill data ──────────────────────────
    if (action === 'create_sheet' || action === 'open_workspace') {
      const url = args.sheetUrl || SHEETS_NEW;
      const page = await openSheets(attachedBrowser, url);
      await waitForEditor(page);

      const sheetName = args.sheetName || args.title || null;
      if (sheetName) await renameSheet(page, sheetName);

      // If data is provided, fill it in
      if (args.data && Array.isArray(args.data)) {
        await fillData(page, args.data, args.startCell || 'A1');
        await saveSheet(page);
      }

      // If headers are provided separately
      if (args.headers && Array.isArray(args.headers)) {
        await fillData(page, [args.headers], args.startCell || 'A1');
        await saveSheet(page);
      }

      const sheetUrl = await getSheetUrl(page);
      return {
        status: 'completed',
        summary: sheetName ? `Sheet "${sheetName}" created` : 'New Google Sheet opened',
        data: { sheetUrl },
      };
    }

    // ── write_data — write rows to an existing or new sheet ───────────────────
    if (action === 'write_data') {
      const url = args.sheetUrl || SHEETS_NEW;
      const page = await openSheets(attachedBrowser, url);
      await waitForEditor(page);

      if (!args.data) throw new Error('write_data requires data (2D array)');
      await fillData(page, args.data, args.startCell || 'A1');
      await saveSheet(page);

      const sheetUrl = await getSheetUrl(page);
      return {
        status: 'completed',
        summary: `Wrote ${args.data.length} rows to Google Sheet`,
        data: { sheetUrl },
      };
    }

    // ── export_to_sheet — write scraped leads/results into a new sheet ────────
    if (action === 'export_to_sheet') {
      const page = await openSheets(attachedBrowser, SHEETS_NEW);
      await waitForEditor(page);

      const records = args.records || args.profiles || args.leads || [];
      if (records.length === 0) {
        return { status: 'completed', summary: 'No data to export', data: {} };
      }

      // Build a 2D table: headers from first record's keys, then values
      const headers = Object.keys(records[0]);
      const rows = records.map(r => headers.map(h => r[h] ?? ''));
      const table = [headers, ...rows];

      const sheetName = args.sheetName || `Export ${new Date().toLocaleDateString()}`;
      await renameSheet(page, sheetName);
      await fillData(page, table, 'A1');
      await saveSheet(page);

      const sheetUrl = await getSheetUrl(page);
      return {
        status: 'completed',
        summary: `Exported ${records.length} records to Google Sheet "${sheetName}"`,
        data: { sheetUrl, recordCount: records.length },
      };
    }

    // ── read_sheet — open a sheet and extract its data ────────────────────────
    if (action === 'read_sheet') {
      if (!args.sheetUrl) throw new Error('read_sheet requires sheetUrl');
      const page = await openSheets(attachedBrowser, args.sheetUrl);
      await waitForEditor(page);
      await pauseLikeHuman(page, 2000, 3000);

      // Extract all cell data from the visible grid
      const tableData = await page.evaluate(() => {
        const rows = [];
        const gridRows = document.querySelectorAll('.waffle-grid-container tr, .grid-row');
        for (const row of gridRows) {
          const cells = Array.from(row.querySelectorAll('td, .cell')).map(td =>
            (td.innerText || td.textContent || '').trim()
          );
          if (cells.some(c => c)) rows.push(cells);
        }
        return rows;
      });

      return {
        status: 'completed',
        summary: `Read ${tableData.length} rows from Google Sheet`,
        data: { table: tableData, sheetUrl: args.sheetUrl },
      };
    }

    throw new Error(`Google Sheets handler does not support action: ${action}`);
  },
};
