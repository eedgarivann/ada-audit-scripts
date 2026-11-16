// CSV export (one row per finding location) for spreadsheets and issue trackers. RFC 4180 quoting.
const q = (v) => {
  const s = Array.isArray(v) ? v.join('; ') : String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const CSV_COLUMNS = [
  'id',
  'title',
  'kind',
  'wcag',
  'level',
  'severity',
  'confidence',
  'plan',
  'effort',
  'quick_win',
  'url',
  'target',
  'widths',
  'how_found',
  'fix',
  'verify',
  'fingerprint',
  'status',
];
export function renderCsv(doc) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const f of doc.findings)
    for (const l of f.locations)
      rows.push(
        [
          f.id,
          f.title,
          f.kind,
          f.wcag.map((w) => w.sc),
          f.wcag.map((w) => w.level),
          f.severity,
          f.confidence,
          f.priority.plan,
          f.effort,
          f.priority.quickWin ? 'yes' : 'no',
          l.url,
          l.target,
          l.widths,
          f.howFound,
          f.remediation.steps[0],
          f.remediation.verify,
          l.fingerprint,
          'Open',
        ]
          .map(q)
          .join(','),
      );
  return rows.join('\r\n') + '\r\n';
}
