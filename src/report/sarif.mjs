// SARIF 2.1.0 export (GitHub code scanning, VS Code SARIF viewer). One result per finding location.
const LEVEL = { blocker: 'error', critical: 'error', serious: 'error', moderate: 'warning', minor: 'note' };
export function renderSarif(doc) {
  const rules = doc.findings.map((f) => ({
    id: f.group,
    name: f.title
      .replace(/[^\w]+/g, ' ')
      .trim()
      .replace(/\s(\w)/g, (_, c) => c.toUpperCase())
      .replace(/^\w/, (c) => c.toUpperCase()),
    shortDescription: { text: f.title },
    fullDescription: { text: `${f.remediation.summary}. ${f.impact.who}` },
    helpUri: f.remediation.references[0] || undefined,
    help: {
      text: `${f.remediation.steps.join(' ')} Verify: ${f.remediation.verify}`,
      markdown: `${f.remediation.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n**Verify:** ${f.remediation.verify}`,
    },
    properties: {
      tags: ['accessibility', ...f.wcag.map((w) => `WCAG${w.sc}`), f.kind],
      kind: f.kind,
      wcag: f.wcag.map((w) => w.sc),
      'problem.severity': LEVEL[f.severity],
    },
    defaultConfiguration: { level: f.kind === 'failure' ? LEVEL[f.severity] : 'note' },
  }));
  const results = doc.findings.flatMap((f, ri) =>
    f.locations.map((l) => ({
      ruleId: f.group,
      ruleIndex: ri,
      level: f.kind === 'failure' ? LEVEL[f.severity] : 'note',
      message: {
        text: `${f.id} ${f.title}${l.target ? ` at ${l.target}` : ''}. ${f.confidence === 'automated-certain' ? '' : 'Needs human confirmation. '}Fix: ${f.remediation.steps[0]}`,
      },
      locations: [
        {
          physicalLocation: { artifactLocation: { uri: l.url || 'site' } },
          ...(l.target ? { logicalLocations: [{ fullyQualifiedName: l.target, kind: 'element' }] } : {}),
        },
      ],
      partialFingerprints: { 'adaAudit/v1': l.fingerprint },
      properties: {
        findingId: f.id,
        severity: f.severity,
        confidence: f.confidence,
        plan: f.priority.plan,
        effort: f.effort,
        widths: l.widths,
      },
    })),
  );
  return (
    JSON.stringify(
      {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [
          {
            tool: {
              driver: { name: 'ada-audit-scripts', version: doc.generator.version || undefined, informationUri: doc.generator.url, rules },
            },
            results,
            properties: { conformance: doc.conformance.statement },
          },
        ],
      },
      null,
      2,
    ) + '\n'
  );
}
