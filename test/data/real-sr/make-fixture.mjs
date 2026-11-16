// Builds the synthetic transcript used by unit tests (phrases modelled on NVDA browse-mode output).
// Not a recording: real transcripts come from `ada-audit sr` / the "Real screen readers" workflow.
export function fixture() {
  const st = (...phrases) => ({ phrases, last: phrases.at(-1) || '' });
  return {
    schema: 'ada-real-sr/1',
    tool: 'real-sr',
    screenReader: { id: 'nvda', name: 'NVDA', version: '2026.3' },
    browser: { name: 'chromium', version: '140.0' },
    os: { platform: 'win32', release: '10.0.26100', arch: 'x64' },
    guidepup: '0.40.0',
    journey: 'fixture',
    url: 'https://shop.test/contact',
    title: 'Contact',
    startedAt: '2026-11-15T00:00:00.000Z',
    finishedAt: '2026-11-15T00:01:00.000Z',
    readOnly: true,
    readOnlyErrorsTested: false,
    blockedWrites: [],
    error: null,
    passes: [
      { pass: 'headings', endReason: 'end', steps: [st('no next heading')] },
      { pass: 'landmarks', endReason: 'end', steps: [st('no next landmark')] },
      {
        pass: 'formFields',
        endReason: 'end',
        steps: [
          st('edit  blank'),
          st('Email  edit  has auto complete  blank'),
          st('QUICKMENU ---->  combo box  collapsed'),
          st('no next form field'),
        ],
      },
      { pass: 'buttons', endReason: 'end', steps: [st('button'), st('Send  button'), st('no next button')] },
      {
        pass: 'links',
        endReason: 'repeat',
        steps: [
          st('link, Home'),
          st('link, click here'),
          st('link, graphic, nav_shop.gif'),
          st('visited  link  Search'),
          st('visited  link  Search'),
          st('visited  link  Search'),
        ],
      },
      {
        pass: 'graphics',
        endReason: 'end',
        steps: [
          st('graphic'),
          st('graphic, spacer'),
          st('graphic, banner_left.jpg'),
          st('graphic, Fresh bread on a wooden board'),
          st('no next graphic'),
        ],
      },
      { pass: 'buttons-extra-unknown', endReason: 'max', steps: [] },
      {
        pass: 'tab',
        endReason: 'max',
        steps: [
          { ...st('link, Home'), dom: { tag: 'a', selector: 'a#home', name: 'Home', url: 'https://shop.test/contact' } },
          {
            ...st('edit  blank'),
            dom: { tag: 'input', type: 'text', selector: 'input#name', name: '', hasLabel: false, url: 'https://shop.test/contact' },
          },
          {
            ...st('QUICKMENU ---->  combo box  collapsed'),
            dom: { tag: 'select', selector: 'select#menu', name: 'QUICKMENU ---->', hasLabel: false, url: 'https://shop.test/contact' },
          },
          { ...st(''), dom: { none: true, url: 'https://shop.test/contact' } },
          { ...st('button'), dom: { tag: 'button', selector: 'button.icon', name: '', url: 'https://shop.test/contact' } },
        ],
      },
    ],
  };
}
