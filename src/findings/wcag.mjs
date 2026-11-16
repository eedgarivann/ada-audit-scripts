// WCAG 2.2 success criteria: number -> [name, level, version introduced]. Source: https://www.w3.org/TR/WCAG22/
// 4.1.1 Parsing is obsolete in WCAG 2.2 and is intentionally omitted.
/** @type {Record<string, [string, 'A'|'AA'|'AAA', '2.0'|'2.1'|'2.2']>} */
export const SC = {
  '1.1.1': ['Non-text Content', 'A', '2.0'],
  '1.2.1': ['Audio-only and Video-only (Prerecorded)', 'A', '2.0'],
  '1.2.2': ['Captions (Prerecorded)', 'A', '2.0'],
  '1.2.3': ['Audio Description or Media Alternative (Prerecorded)', 'A', '2.0'],
  '1.2.4': ['Captions (Live)', 'AA', '2.0'],
  '1.2.5': ['Audio Description (Prerecorded)', 'AA', '2.0'],
  '1.3.1': ['Info and Relationships', 'A', '2.0'],
  '1.3.2': ['Meaningful Sequence', 'A', '2.0'],
  '1.3.3': ['Sensory Characteristics', 'A', '2.0'],
  '1.3.4': ['Orientation', 'AA', '2.1'],
  '1.3.5': ['Identify Input Purpose', 'AA', '2.1'],
  '1.4.1': ['Use of Color', 'A', '2.0'],
  '1.4.2': ['Audio Control', 'A', '2.0'],
  '1.4.3': ['Contrast (Minimum)', 'AA', '2.0'],
  '1.4.4': ['Resize Text', 'AA', '2.0'],
  '1.4.5': ['Images of Text', 'AA', '2.0'],
  '1.4.6': ['Contrast (Enhanced)', 'AAA', '2.0'],
  '1.4.10': ['Reflow', 'AA', '2.1'],
  '1.4.11': ['Non-text Contrast', 'AA', '2.1'],
  '1.4.12': ['Text Spacing', 'AA', '2.1'],
  '1.4.13': ['Content on Hover or Focus', 'AA', '2.1'],
  '2.1.1': ['Keyboard', 'A', '2.0'],
  '2.1.2': ['No Keyboard Trap', 'A', '2.0'],
  '2.1.4': ['Character Key Shortcuts', 'A', '2.1'],
  '2.2.1': ['Timing Adjustable', 'A', '2.0'],
  '2.2.2': ['Pause, Stop, Hide', 'A', '2.0'],
  '2.2.4': ['Interruptions', 'AAA', '2.0'],
  '2.3.1': ['Three Flashes or Below Threshold', 'A', '2.0'],
  '2.4.1': ['Bypass Blocks', 'A', '2.0'],
  '2.4.2': ['Page Titled', 'A', '2.0'],
  '2.4.3': ['Focus Order', 'A', '2.0'],
  '2.4.4': ['Link Purpose (In Context)', 'A', '2.0'],
  '2.4.5': ['Multiple Ways', 'AA', '2.0'],
  '2.4.6': ['Headings and Labels', 'AA', '2.0'],
  '2.4.7': ['Focus Visible', 'AA', '2.0'],
  '2.4.11': ['Focus Not Obscured (Minimum)', 'AA', '2.2'],
  '2.4.12': ['Focus Not Obscured (Enhanced)', 'AAA', '2.2'],
  '2.4.13': ['Focus Appearance', 'AAA', '2.2'],
  '2.5.1': ['Pointer Gestures', 'A', '2.1'],
  '2.5.2': ['Pointer Cancellation', 'A', '2.1'],
  '2.5.3': ['Label in Name', 'A', '2.1'],
  '2.5.4': ['Motion Actuation', 'A', '2.1'],
  '2.5.5': ['Target Size (Enhanced)', 'AAA', '2.1'],
  '2.5.7': ['Dragging Movements', 'AA', '2.2'],
  '2.5.8': ['Target Size (Minimum)', 'AA', '2.2'],
  '3.1.1': ['Language of Page', 'A', '2.0'],
  '3.1.2': ['Language of Parts', 'AA', '2.0'],
  '3.2.1': ['On Focus', 'A', '2.0'],
  '3.2.2': ['On Input', 'A', '2.0'],
  '3.2.3': ['Consistent Navigation', 'AA', '2.0'],
  '3.2.4': ['Consistent Identification', 'AA', '2.0'],
  '3.2.6': ['Consistent Help', 'A', '2.2'],
  '3.3.1': ['Error Identification', 'A', '2.0'],
  '3.3.2': ['Labels or Instructions', 'A', '2.0'],
  '3.3.3': ['Error Suggestion', 'AA', '2.0'],
  '3.3.4': ['Error Prevention (Legal, Financial, Data)', 'AA', '2.0'],
  '3.3.7': ['Redundant Entry', 'A', '2.2'],
  '3.3.8': ['Accessible Authentication (Minimum)', 'AA', '2.2'],
  '4.1.2': ['Name, Role, Value', 'A', '2.0'],
  '4.1.3': ['Status Messages', 'AA', '2.1'],
};

/** Understanding-document slug for a criterion (W3C URL). */
const SLUG = (name) => name.toLowerCase().replace(/[(),]/g, '').replace(/\s+/g, '-');
export function scRef(num) {
  const s = SC[num];
  if (!s) return null;
  return { sc: num, name: s[0], level: s[1], since: s[2], url: `https://www.w3.org/WAI/WCAG22/Understanding/${SLUG(s[0])}.html` };
}

/** axe tag like "wcag143" -> "1.4.3"; "wcag2411" -> "2.4.11". */
export function scFromAxeTag(tag) {
  const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}
