import { get, type Writable } from 'svelte/store';
import { safeWritable } from '$lib/logic/safe-store';
import { currentTool, type Tool } from '$lib/components/toolbar/tools';

// Clean mode hides every piece of UI chrome (menu bar, toolbars, bottom bar, side/bottom panels and
// the MapLibre corner controls) so only the map remains. Map *content* — tracks, waypoints,
// distance/direction markers — is untouched: the underlying settings keep their values and the UI
// comes back exactly as it was.
//
// Deliberately a plain store and NOT a `Setting`: it must not be persisted. In clean mode there is
// no menu to switch it off from, so a reload always has to bring the chrome back — that is the
// safety net against being locked out of the UI.
export const cleanMode: Writable<boolean> = safeWritable(false, 'cleanMode');

// The tool that was active when clean mode was entered, restored on exit.
let parkedTool: Tool | null = null;

export function setCleanMode(value: boolean) {
    if (value === get(cleanMode)) {
        return;
    }
    if (value) {
        // Park the active tool. Its on-map affordances (routing anchors, split markers, the
        // tool-specific start/end markers) are driven by `currentTool` subscriptions, and they are
        // editing controls rather than track content — so they go away with the rest of the chrome.
        parkedTool = get(currentTool);
        currentTool.set(null);
    } else if (parkedTool !== null) {
        currentTool.set(parkedTool);
        parkedTool = null;
    }
    cleanMode.set(value);
}

export function toggleCleanMode() {
    setCleanMode(!get(cleanMode));
}
