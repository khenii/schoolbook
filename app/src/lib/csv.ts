// Client-side CSV export. School-scale data (hundreds to low thousands of
// rows) is comfortably small enough to build and download entirely in the
// browser — no server round-trip needed.
export function exportToCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(',')].concat(rows.map((r) => r.map(escape).join(','))).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Minimal RFC-4180-ish CSV parser — handles quoted fields (so commas and
// escaped double-quotes inside a cell don't split it), \r\n or \n line
// endings, and blank trailing lines. Good enough for the sheets Excel/Google
// Sheets produce when staff fill in the import templates; not a full CSV
// spec implementation (no embedded newlines inside quoted fields).
export function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  });
}
