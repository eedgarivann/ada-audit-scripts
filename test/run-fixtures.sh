#!/usr/bin/env bash
# Offline test: serves test/fixtures on 127.0.0.1 (GET-only) and checks expected detections + clean controls.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-4175}; B=http://127.0.0.1:$PORT; O=${OUT:-./audit-output/fixtures}
node test/serve.mjs $PORT & SRV=$!; trap 'kill $SRV' EXIT; sleep 1
rm -rf "$O"; mkdir -p "$O"
L() { local s=""; for p in "$@"; do s+="$B/$p.html,"; done; echo "${s%,}"; }
node inventory.mjs --urls "$(L index-good ro-good)" --out "$O"
node axe-scan.mjs --urls "$(L index-good)" --widths 390 --out "$O"
node tab-walk.mjs --urls "$(L index-good)" --out "$O"
node focus-state.mjs --urls "$(L index-good)" --selector "a" --out "$O"
node menu-modal.mjs --urls "$(L mega-good)" --trigger "button[aria-expanded]" --width 1280 --out "$O"
node forms.mjs --urls "$(L lantern)" --out "$O"
node reflow.mjs --urls "$(L index-good)" --out "$O"
node motion.mjs --urls "$(L carousel-bad)" --out "$O"
node sr-transcript.mjs --urls "$(L index-good)" --max 200 --out "$O"
node context-change.mjs --urls "$(L lantern)" --out "$O"
node sample-compare.mjs --urls "$(L index-good about help)" --out "$O"
node bypass-order.mjs --urls "$(L ro-bad-flex ro-bad-order ro-bad-abs ro-bad-grid ro-bad-tabindex ro-good bypass-none bypass-broken-target bypass-noop bypass-hidden bypass-good bypass-short-good)" --widths 1440 --out "$O"
node journeys.mjs --urls "$(L mega-bad mega-good cookie-bad overlay-bad carousel-bad timeout-bad targets-bad)" --target lantern --watch 16 --out "$O"
node journeys.mjs --urls "$(L carticon-bad)" --goal checkout --personas sr --out "$O"
F=0; for d in inventory axe tab-walk focus-state menu-modal forms reflow motion sr-transcript context-change sample-compare; do if ls "$O/$d" >/dev/null 2>&1 && [ -n "$(ls -A "$O/$d")" ]; then echo "ok   $d produced output"; else echo "FAIL $d no output"; F=1; fi; done; f() { local file=$1 pat=$2 want=$3; local hit=0; grep -qE "$pat" $file 2>/dev/null && hit=1; if [ "$hit" != "$want" ]; then echo "FAIL $want '$pat' in $file"; F=1; else echo "ok   $want '$pat' $(basename $file)"; fi; }
BO=$O/bypass-order; J=$O/journeys; s=127_0_0_1_${PORT}_
for p in ro_bad_flex ro_bad_order ro_bad_abs ro_bad_grid; do f "$BO/${s}${p}_html_1440.txt" '^READING-ORDER\?\(1\.3\.2,(high|medium)' 1; done
f "$BO/${s}ro_bad_tabindex_html_1440.txt" '^FOCUS-ORDER-JUMP\?\(2\.4\.3/1\.3\.2,high' 1
for p in bypass_none bypass_noop bypass_hidden; do f "$BO/${s}${p}_html_1440.txt" '^BYPASS-NONE' 1; done
f "$BO/${s}bypass_broken_target_html_1440.txt" '^SKIP-TARGET-MISSING' 1
for p in ro_good bypass_good bypass_short_good; do f "$BO/${s}${p}_html_1440.txt" '^(READING-ORDER|FOCUS-ORDER-JUMP|BYPASS-NONE|SKIP-)' 0; done
f "$J/${s}mega_bad_html.txt" 'HOVER-ONLY-MENU' 1
f "$J/${s}mega_good_html.txt" 'HOVER-ONLY-MENU' 0
f "$J/${s}cookie_bad_html.txt" 'KEYBOARD-TRAP|OVERLAY-NO-KEYBOARD-EXIT' 1
f "$J/${s}overlay_bad_html.txt" 'OVERLAY-NO-KEYBOARD-EXIT' 1
f "$J/${s}carousel_bad_html.txt" 'AUTO-ADVANCE' 1
f "$J/${s}timeout_bad_html.txt" 'TIMED-NAVIGATION' 1
f "$J/${s}targets_bad_html.txt" 'TARGET-TOO-SMALL' 1
f "$J/${s}carticon_bad_html.txt" 'SR-MUST-GUESS' 1
f "$J/${s}mega_good_html.txt" 'Keyboard-only user: reached' 1
exit $F
