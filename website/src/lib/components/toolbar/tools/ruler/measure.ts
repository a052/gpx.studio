import type { Coordinates } from 'gpx';
import { safeWritable } from '$lib/logic/safe-store';

// Shared state for the ruler tool. This is a display-only overlay: the points live here (never in
// any GPX file or the Dexie database), so measuring creates no undo history and cannot corrupt a
// trace. `MeasureControls` writes both stores; the `Ruler.svelte` panel reads them.
export const measurePoints = safeWritable<Coordinates[]>([], 'measurePoints');
export const measureTotalKm = safeWritable<number>(0, 'measureTotalKm');
