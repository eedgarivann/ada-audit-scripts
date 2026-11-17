/** ada-audit-scripts public API (ESM). Findings are candidates, never a conformance claim. Schema: schema/findings.schema.json. */
export type Severity = 'blocker' | 'critical' | 'serious' | 'moderate' | 'minor';
export type Confidence = 'automated-certain' | 'needs-review' | 'inferred';
export type Kind = 'failure' | 'best-practice' | 'aaa' | 'advisory' | 'not-tested' | 'other-risk';
export type Plan = 'fix-now' | 'fix-next' | 'monitor';
export type Effort = 'low' | 'medium' | 'high';
export type Format = 'json' | 'md' | 'html' | 'pdf' | 'sarif' | 'csv';
export type Paper = 'a4' | 'letter';
export type Platform = 'wordpress' | 'shopify' | 'webflow' | 'framer' | 'squarespace' | 'wix' | 'react';
export interface WcagRef {
  sc: string;
  name: string;
  level: 'A' | 'AA' | 'AAA';
  since: string;
  url: string;
}
/** How evidence was gathered. 'real-screen-reader' = NVDA/VoiceOver via Guidepup; never the simulated one. */
export type Method = 'automated-rules' | 'scripted-browser' | 'simulated-screen-reader' | 'simulated-persona' | 'real-screen-reader';
export interface Evidence {
  tool: string;
  method?: Method;
  rule: string;
  detail: string;
  file?: string;
  line?: number | null;
  html?: string;
}
export interface Location {
  url: string | null;
  target: string | null;
  widths: number[];
  journey: string | null;
  screenshots: string[];
  evidence: Evidence[];
  fingerprint: string;
}
export interface Remediation {
  concept: string;
  summary: string;
  steps: string[];
  before: string | null;
  after: string | null;
  platforms: Partial<Record<Platform, string>>;
  verify: string;
  references: string[];
}
export interface Finding {
  id: string;
  fingerprint: string;
  group: string;
  title: string;
  kind: Kind;
  wcag: WcagRef[];
  severity: Severity;
  confidence: Confidence;
  corroborated: boolean;
  priority: { plan: Plan; rung: 1 | 2 | 3 | 4 | 5; score: number; quickWin: boolean };
  effort: Effort;
  onCriticalJourney: boolean;
  journeyAssumed: boolean;
  scope: 'single-page' | 'multi-page';
  pages: number;
  occurrences: number;
  impact: { who: string; personas: string[]; simulatedOutcomes: string[] };
  howFound: string[];
  methods?: Method[];
  rules: string[];
  tools: string[];
  locations: Location[];
  remediation: Remediation;
}
export interface Summary {
  total: number;
  failures: number;
  failuresConfirmedByRules: number;
  byKind: Record<Kind, number>;
  bySeverity: Record<Severity, number>;
  byConfidence: Record<Confidence, number>;
  byPlan: Record<Plan, number>;
  quickWins: number;
  pagesWithFindings: number;
  suppressedCandidates: number;
}
export interface Journey {
  name: string;
  goal?: string;
  target?: string;
  urls: string[];
}
export interface RunMeta {
  startedAt?: string;
  finishedAt?: string;
  pages: string[];
  tools: string[];
  widths?: number[];
  versions?: Record<string, string | null>;
  readOnly?: boolean;
  platform?: Platform | null;
}
export interface JourneyOutcome {
  url: string | null;
  persona: string;
  personaLabel: string;
  outcome: string;
  steps: number | null;
  simSeconds: number | null;
  friction: string | null;
}
export interface ManualCheck {
  sc: string;
  check: string;
  priority?: boolean;
}
export interface RealScreenReaderRun {
  screenReader: string;
  screenReaderVersion: string | null;
  browser: string;
  browserVersion: string | null;
  os: string | null;
  guidepup: string | null;
  url: string;
  journey: string | null;
  /** path of the human-readable transcript, relative to the output folder */
  transcript: string;
  ok: boolean;
  passes: { pass: string; steps: number; endReason: string | null; error: string | null }[];
  stats: Record<string, number>;
}
export interface FindingsDocument {
  $schema: string;
  schemaVersion: string;
  generator: { name: 'ada-audit-scripts'; version: string | null; url: string };
  run: RunMeta;
  criticalJourneys: Journey[];
  journeysAssumed: boolean;
  summary: Summary;
  journeys: JourneyOutcome[];
  realScreenReader?: RealScreenReaderRun[];
  findings: Finding[];
  suppressed: { ruleId: string; url: string | null; reason: string }[];
  errors: string[];
  conformance: { target: string; statement: string; claim: false };
  manualChecklist: ManualCheck[];
}
export interface RawCandidate {
  tool: string;
  ruleId: string;
  url: string | null;
  width: number | null;
  target: string | null;
  detail: string;
  file: string;
  line?: number;
  screenshot?: string | null;
  toolConfidence?: string;
  persona?: string;
  outcome?: string;
  journeyGoal?: string;
  axe?: Record<string, unknown>;
  helpUrl?: string;
}
export interface Rule {
  id: string;
  tool: string;
  code: string;
  concept: string;
  sc: string[];
  kind: Kind | 'info';
  confidence: Confidence;
  severity: Severity;
  title?: string;
  group?: string;
  re?: RegExp;
}
export interface Remedy {
  title: string;
  who: string;
  rung: number;
  effort: Effort;
  steps: string[];
  before?: string;
  after?: string;
  platforms?: Partial<Record<Platform, string>>;
  verify: string;
  refs?: string[];
}
export function collectRaw(dir: string): RawCandidate[];
export const ADAPTERS: Record<string, (dir: string) => RawCandidate[]>;
export function buildFindings(
  raws: RawCandidate[],
  ctx?: { journeys?: Journey[]; versions?: Record<string, string>; scope?: object; now?: string },
): { findings: Finding[]; suppressed: FindingsDocument['suppressed']; errors: string[] };
export function summarize(findings: Finding[], suppressed?: FindingsDocument['suppressed']): Summary;
export function buildDocument(dir: string, opts?: { run?: Partial<RunMeta>; journeys?: Journey[] }): FindingsDocument;
export function journeyOutcomes(dir: string): JourneyOutcome[];
export function validateDocument(doc: unknown): string[];
export function renderMarkdown(
  doc: FindingsDocument,
  opts?: { outDir?: string; platform?: Platform | null; maxLocations?: number },
): string;
export function renderHtml(doc: FindingsDocument, opts?: { outDir?: string; platform?: Platform | null; maxLocations?: number }): string;
export function renderSarif(doc: FindingsDocument): string;
export function renderCsv(doc: FindingsDocument): string;
export function writeReports(
  doc: FindingsDocument,
  outDir: string,
  opts?: { formats?: Exclude<Format, 'pdf'>[]; platform?: Platform | null },
): Partial<Record<Format, string>>;
/** Every format including the PDF report (needs Playwright Chromium). */
export function writeAllReports(
  doc: FindingsDocument,
  outDir: string,
  opts?: { formats?: Format[]; platform?: Platform | null; paper?: Paper },
): Promise<Partial<Record<Format, string>>>;
/** Render the PDF report (cover, summary, top issues with screenshots, table, fix cards, limits). Returns the file path. */
export function writePdf(
  doc: FindingsDocument,
  outDir: string,
  opts?: { platform?: Platform | null; paper?: Paper; file?: string },
): Promise<string>;
export const FORMATS: Record<Format, string>;
export const SCHEMA_VERSION: '1.1.0';
export const RULES: Rule[];
export const REMEDIES: Record<string, Remedy>;
export const SC: Record<string, [string, 'A' | 'AA' | 'AAA', string]>;
export const AXE_CONCEPT: Record<string, string>;
export function rulesFor(tool: string): Rule[];
export function scRef(num: string): WcagRef | null;
export function scFromAxeTag(tag: string): string | null;
export function normUrl(u: string | null): string | null;
export function targetKey(t: string | null): string;
/** Parse one spoken screen-reader announcement (NVDA or VoiceOver wording). */
export function parsePhrase(
  phrase: string,
  expect?: string[],
): {
  raw: string;
  role: string | null;
  name: string;
  states: string[];
  level: number | null;
  end: boolean;
  unlabeled: boolean;
  guess: string | null;
};
/** Turn a real screen-reader transcript (schema "ada-real-sr/1") into rule-coded flags. */
export function analyzeTranscript(t: object): {
  flags: { code: string; pass: string; step: number | null; target: string | null; detail: string; spoken?: string }[];
  stats: Record<string, number>;
  errors: string[];
};
export function realScreenReaderRuns(dir: string): RealScreenReaderRun[];
