import type {
    StyleSpecification,
    LayerSpecification,
    VectorSourceSpecification,
    ExpressionSpecification,
} from 'maplibre-gl';

export type MapUnits = 'metric' | 'imperial' | 'nautical';

// Minimal shape of a TileJSON document (https://github.com/mapbox/tilejson-spec).
// Only the fields we consume are typed; `layers` lets us tell a real MapLibre style
// (which has it) apart from a TileJSON (which does not).
export type TileJSON = {
    tiles?: string[];
    vector_layers?: { id: string; fields?: Record<string, unknown> }[];
    tilestats?: { layers?: { layer: string; geometry?: string }[] };
    minzoom?: number;
    maxzoom?: number;
    attribution?: string;
    bounds?: [number, number, number, number];
    layers?: unknown[];
};

export type VectorLayerDef = {
    id: string;
    geometry?: string; // 'LineString' | 'Polygon' | 'Point' | ...
    hasNthLine?: boolean;
};

const CONTOUR_LINE_COLOR = '#a9702a';
const VECTOR_FILL_COLOR = '#3b82f6';

// Thicker "index" contour lines (MapTiler nth_line is 0/1/2/5/10; 5 and 10 are index).
const INDEX_LINE_WIDTH = [
    'case',
    ['>=', ['coalesce', ['get', 'nth_line'], 0], 5],
    1.4,
    0.55,
] as ExpressionSpecification;

// Classify a custom-layer URL. A raw vector tile template (.pbf/.mvt) carries no
// metadata; a .json is either a MapLibre style or a TileJSON (resolved after fetch).
export function detectVectorKind(url: string): 'raster' | 'json' | 'xyz-vector' {
    const path = url.split('?')[0].toLowerCase();
    if (path.endsWith('.pbf') || path.endsWith('.mvt')) return 'xyz-vector';
    if (url.toLowerCase().includes('.json')) return 'json';
    return 'raster';
}

// A TileJSON describes a source (tiles/vector_layers) but has no style `layers`.
export function isTileJSON(json: TileJSON): boolean {
    if (Array.isArray(json.layers)) return false;
    return Array.isArray(json.tiles) || Array.isArray(json.vector_layers);
}

// Collapse metric/imperial layer pairs (e.g. `contour` + `contour_ft`), keeping only
// the side matching the app's unit setting. Mirrors the metric-for-nautical convention
// already used in style.ts merge(). Unpaired layers pass through untouched.
export function pickVectorLayersForUnits<T extends { id: string }>(
    defs: T[],
    units: MapUnits
): T[] {
    const ids = new Set(defs.map((d) => d.id));
    const imperial = units === 'imperial';
    return defs.filter((d) => {
        if (d.id.endsWith('_ft')) {
            const base = d.id.slice(0, -3);
            if (ids.has(base) || ids.has(base + '_m')) return imperial;
            return true;
        }
        const hasFtCounterpart =
            ids.has(d.id + '_ft') || (d.id.endsWith('_m') && ids.has(d.id.slice(0, -2) + '_ft'));
        if (hasFtCounterpart) return !imperial;
        return true;
    });
}

function layersForDef(sourceId: string, def: VectorLayerDef): LayerSpecification[] {
    const geom = (def.geometry ?? '').toLowerCase();
    const base = `${sourceId}-${def.id}`;
    const out: LayerSpecification[] = [];
    const wantLine = !geom || geom.includes('line');
    const wantFill = geom.includes('polygon');
    const wantCircle = geom.includes('point');
    if (wantFill) {
        out.push({
            id: `${base}-fill`,
            type: 'fill',
            source: sourceId,
            'source-layer': def.id,
            paint: { 'fill-color': VECTOR_FILL_COLOR, 'fill-opacity': 0.25 },
        });
    }
    if (wantLine) {
        out.push({
            id: `${base}-line`,
            type: 'line',
            source: sourceId,
            'source-layer': def.id,
            paint: {
                'line-color': CONTOUR_LINE_COLOR,
                'line-width': def.hasNthLine ? INDEX_LINE_WIDTH : 0.7,
            },
        });
    }
    if (wantCircle) {
        out.push({
            id: `${base}-circle`,
            type: 'circle',
            source: sourceId,
            'source-layer': def.id,
            paint: { 'circle-color': CONTOUR_LINE_COLOR, 'circle-radius': 2.5 },
        });
    }
    return out;
}

// Build style layers for the given vector source-layers, after unit-pair filtering.
export function synthesizeVectorLayers(
    sourceId: string,
    defs: VectorLayerDef[],
    units: MapUnits
): LayerSpecification[] {
    return pickVectorLayersForUnits(defs, units).flatMap((def) => layersForDef(sourceId, def));
}

// Turn a fetched TileJSON into a self-contained MapLibre style (source + layers).
// `opts.tiles` overrides the source tile URLs (e.g. the exact URL the user typed for a
// raw XYZ layer); `opts.only` restricts synthesis to the named source-layers (an explicit
// user choice) instead of every layer the TileJSON advertises.
export function styleFromTileJSON(
    tilejson: TileJSON,
    sourceId: string,
    units: MapUnits,
    opts: { tiles?: string[]; only?: string[] } = {}
): StyleSpecification {
    const source: VectorSourceSpecification = {
        type: 'vector',
        tiles: opts.tiles ?? tilejson.tiles ?? [],
    };
    if (tilejson.minzoom !== undefined) source.minzoom = tilejson.minzoom;
    if (tilejson.maxzoom !== undefined) source.maxzoom = tilejson.maxzoom;
    if (tilejson.attribution) source.attribution = tilejson.attribution;
    if (tilejson.bounds) source.bounds = tilejson.bounds;

    const geometryOf = (id: string) =>
        tilejson.tilestats?.layers?.find((l) => l.layer === id)?.geometry;
    let vectorLayers = tilejson.vector_layers ?? [];
    if (opts.only && opts.only.length > 0) {
        vectorLayers = vectorLayers.filter((vl) => opts.only!.includes(vl.id));
    }
    const defs: VectorLayerDef[] = vectorLayers.map((vl) => ({
        id: vl.id,
        geometry: geometryOf(vl.id),
        hasNthLine: !!vl.fields && 'nth_line' in vl.fields,
    }));

    return {
        version: 8,
        sources: { [sourceId]: source },
        layers: synthesizeVectorLayers(sourceId, defs, units),
    };
}

// A raw XYZ vector template carries no metadata, but most providers expose a sibling
// TileJSON at the tileset root. Derive it by swapping the `/{z}/{x}/{y}.<ext>` tail for
// `/tiles.json`, preserving the query string (e.g. the API key). Returns null when the
// URL is not a recognizable XYZ template.
export function deriveTileJSONUrl(xyzUrl: string): string | null {
    const qIndex = xyzUrl.indexOf('?');
    const path = qIndex === -1 ? xyzUrl : xyzUrl.slice(0, qIndex);
    const query = qIndex === -1 ? '' : xyzUrl.slice(qIndex);
    const match = path.match(/^(.*?)\/\{z\}\/\{x\}\/\{y\}\.[a-z0-9]+$/i);
    if (!match) return null;
    return `${match[1]}/tiles.json${query}`;
}
