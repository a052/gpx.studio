import { get } from 'svelte/store';
import { settings } from '$lib/logic/settings';

// Selectable elevation (DEM) tile sources for numeric elevation sampling (`getElevation`).
// All presets are Terrarium-encoded XYZ tilesets, so the decoder in `utils.ts` is shared.
// Custom URLs are assumed Terrarium-encoded as well. Mapterhorn is the default.
export const elevationSourcePresets = ['mapterhorn', 'aws', 'custom'] as const;

// XYZ tile URL templates with {z}/{x}/{y} placeholders (custom is user-provided).
const TEMPLATES: Record<Exclude<(typeof elevationSourcePresets)[number], 'custom'>, string> = {
    mapterhorn: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
    aws: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
};

function fillTemplate(template: string, z: number, x: number, y: number): string {
    return template
        .replaceAll('{z}', z.toString())
        .replaceAll('{x}', x.toString())
        .replaceAll('{y}', y.toString());
}

// Resolve the tile URL for the active elevation source, read at call time (like routing.ts).
export function getElevationTileUrl(z: number, x: number, y: number): string {
    const source = get(settings.elevationSource);
    if (source === 'custom') {
        const custom = get(settings.elevationSourceCustomUrl).trim();
        if (custom.length > 0) {
            return fillTemplate(custom, z, x, y);
        }
        return fillTemplate(TEMPLATES.mapterhorn, z, x, y);
    }
    return fillTemplate(TEMPLATES[source], z, x, y);
}
