import { settings } from '$lib/logic/settings';
import type * as maplibregl from 'maplibre-gl';
import { get, type Writable } from 'svelte/store';
import {
    basemaps,
    defaultBasemap,
    maptilerKeyPlaceHolder,
    overlays,
    terrainSources,
} from '$lib/assets/layers';
import { getLayers } from '$lib/components/map/layer-control/utils';
import { i18n } from '$lib/i18n.svelte';

const {
    currentBasemap,
    currentOverlays,
    customLayers,
    opacities,
    terrainSource,
    distanceUnits,
    threeD,
    projection,
} = settings;

const emptySource: maplibregl.GeoJSONSourceSpecification = {
    type: 'geojson',
    data: {
        type: 'FeatureCollection',
        features: [],
    },
};

// Sky config. Everything keeps MapLibre's spec defaults (blue `sky-color: #88C6FC`, white
// horizon/fog) EXCEPT `fog-ground-blend`, raised from the default 0.5 to 0.8 so the terrain fog only
// builds up near the horizon and distant terrain stays clearer. Must be present at map construction
// (see map.ts): a sky-less constructor seeds the Sky transparent and a later `setSky` only overwrites
// the keys it is given. Terrain fog is rendered only in mercator (globe disables it and uses the
// atmosphere pass instead), so this affects the flat/3D view only.
export const SKY: maplibregl.SkySpecification = {
    'fog-ground-blend': 1,
};

export const ANCHOR_LAYER_KEY = {
    overlays: 'overlays-end',
    mapillary: 'mapillary-end',
    tracks: 'tracks-end',
    directionMarkers: 'direction-markers-end',
    distanceMarkers: 'distance-markers-end',
    startEndMarkers: 'start-end-markers-end',
    interactions: 'interactions-end',
    overpass: 'overpass-end',
    waypoints: 'waypoints-end',
    routingControls: 'routing-controls-end',
};
const anchorLayers: maplibregl.LayerSpecification[] = Object.values(ANCHOR_LAYER_KEY).map((id) => ({
    id: id,
    type: 'symbol',
    source: 'empty-source',
}));

export class StyleManager {
    private _map: Writable<maplibregl.Map | null>;
    private _maptilerKey: string;
    private _pastOverlays: Set<string> = new Set();
    private _basemapUpdateId = 0;

    constructor(map: Writable<maplibregl.Map | null>, maptilerKey: string) {
        this._map = map;
        this._maptilerKey = maptilerKey;
        this._map.subscribe((map_) => {
            if (map_) {
                this.updateBasemap();
                map_.on('style.load', () => {
                    this.updateOverlays();
                    this.updateTerrain();
                    this.updateProjection();
                });
            }
        });
        currentBasemap.subscribe(() => this.updateBasemap());
        currentOverlays.subscribe(() => this.updateOverlays());
        opacities.subscribe(() => this.updateOverlays());
        terrainSource.subscribe(() => this.updateTerrain());
        threeD.subscribe(() => this.updateTerrain());
        projection.subscribe(() => this.updateProjection());
        customLayers.subscribe(() => this.updateBasemap());
        distanceUnits.subscribe(() => {
            const map = get(this._map);
            if (map && (map.getLayer('contours_m') || map.getLayer('contours_ft'))) {
                this.updateBasemap();
            }
        });
    }

    updateBasemap() {
        const map_ = get(this._map);
        if (!map_) return;
        let basemap = get(currentBasemap);
        const updateId = ++this._basemapUpdateId;
        this.buildStyle(basemap).then((style) => {
            // Only the most recent update may apply its style. This prevents a stale build
            // (e.g. the default-basemap fallback produced while customLayers was still loading
            // on page load) from overwriting the correct basemap once its async build resolves.
            if (this._basemapUpdateId === updateId) map_.setStyle(style);
        });
    }

    async buildStyle(basemap: string): Promise<maplibregl.StyleSpecification> {
        const custom = get(customLayers);

        const style: maplibregl.StyleSpecification = {
            version: 8,
            projection: {
                type: get(projection),
            },
            sky: SKY,
            sources: {
                'empty-source': emptySource,
            },
            layers: [],
        };

        const basemapInfo = basemaps[basemap] ?? custom[basemap]?.value ?? basemaps[defaultBasemap];

        let basemapStyle = basemaps.openStreetMap as maplibregl.StyleSpecification;
        try {
            basemapStyle = await this.get(basemapInfo);
            for (const source in basemapStyle.sources) {
                const src = basemapStyle.sources[source];
                if (
                    src &&
                    typeof src === 'object' &&
                    'url' in src &&
                    typeof src.url === 'string' &&
                    src.url.includes(maptilerKeyPlaceHolder)
                ) {
                    src.url = src.url.replace(maptilerKeyPlaceHolder, this._maptilerKey);
                }
            }
        } catch (e) {
            console.error(e instanceof Error ? e.message : e);
        }
        this.merge(style, basemapStyle);

        const terrain = this.getCurrentTerrain();
        style.sources[terrain.source] = terrainSources[terrain.source];
        style.terrain = terrain.exaggeration > 0 ? terrain : undefined;

        style.layers.push(...anchorLayers);

        return style;
    }

    async updateOverlays() {
        const map_ = get(this._map);
        if (!map_) return;
        if (!map_.getSource('empty-source')) return;

        const custom = get(customLayers);
        const overlayOpacities = get(opacities);
        try {
            const layers = getLayers(get(currentOverlays) ?? {});
            for (let overlay in layers) {
                if (!layers[overlay]) {
                    if (this._pastOverlays.has(overlay)) {
                        const overlayInfo = custom[overlay]?.value ?? overlays[overlay];
                        try {
                            const overlayStyle = await this.get(overlayInfo);
                            for (let layer of overlayStyle.layers ?? []) {
                                if (map_.getLayer(layer.id)) {
                                    map_.removeLayer(layer.id);
                                }
                            }
                        } catch (e) {
                            // Should not happen
                        }
                        this._pastOverlays.delete(overlay);
                    }
                } else {
                    const overlayInfo = custom[overlay]?.value ?? overlays[overlay];
                    try {
                        const overlayStyle = await this.get(overlayInfo);
                        const opacity = overlayOpacities[overlay];

                        for (let sourceId in overlayStyle.sources) {
                            if (!map_.getSource(sourceId)) {
                                map_.addSource(sourceId, overlayStyle.sources[sourceId]);
                            }
                        }

                        for (let layer of overlayStyle.layers ?? []) {
                            if (!map_.getLayer(layer.id)) {
                                if (opacity !== undefined) {
                                    if (layer.type === 'raster') {
                                        if (!layer.paint) {
                                            layer.paint = {};
                                        }
                                        layer.paint['raster-opacity'] = opacity;
                                    } else if (layer.type === 'hillshade') {
                                        if (!layer.paint) {
                                            layer.paint = {};
                                        }
                                        layer.paint['hillshade-exaggeration'] = opacity / 2;
                                    }
                                }
                                map_.addLayer(layer, ANCHOR_LAYER_KEY.overlays);
                            }
                        }
                        this._pastOverlays.add(overlay);
                    } catch (e) {
                        console.error(e instanceof Error ? e.message : e);
                    }
                }
            }
        } catch (e) {}
    }

    updateTerrain() {
        const map_ = get(this._map);
        if (!map_) return;
        const mapTerrain = map_.getTerrain();
        const terrain = this.getCurrentTerrain();
        if (JSON.stringify(mapTerrain) !== JSON.stringify(terrain)) {
            try {
                if (terrain.exaggeration > 0) {
                    if (!map_.getSource(terrain.source)) {
                        map_.addSource(terrain.source, terrainSources[terrain.source]);
                    }
                    map_.setTerrain(terrain);
                } else {
                    map_.setTerrain(null);
                }
            } catch (e) {
                // Only expected while a style swap is in flight ("Style is not done loading"); the
                // style.load handler re-applies. Do NOT gate this on map.isStyleLoaded(): that also
                // reports false whenever any source still has tiles loading, which would drop the
                // toggle for good.
                console.error('updateTerrain failed', e);
            }
        }
    }

    // The stored projection hydrates from the database after the map is built, so apply it to a live
    // map too — not just through buildStyle. No loop with GlobeControl: it sets the projection first,
    // and the equality check makes the resulting store update a no-op.
    updateProjection() {
        const map_ = get(this._map);
        if (!map_) return;
        const type = get(projection);
        if (map_.getProjection()?.type !== type) {
            try {
                map_.setProjection({ type });
            } catch (e) {
                // Style swap in flight; the style.load handler re-applies.
                console.error('updateProjection failed', e);
            }
        }
    }

    async get(
        styleInfo: maplibregl.StyleSpecification | string
    ): Promise<maplibregl.StyleSpecification> {
        if (typeof styleInfo === 'string') {
            let styleUrl = styleInfo as string;
            const response = await fetch(styleUrl, { cache: 'force-cache' });
            if (!response.ok) {
                throw new Error(`HTTP error fetching style "${styleInfo}": ${response.status}`);
            }
            const style = await response.json();
            return style;
        } else {
            return styleInfo;
        }
    }

    merge(style: maplibregl.StyleSpecification, other: maplibregl.StyleSpecification) {
        style.sources = { ...style.sources, ...other.sources };
        const units = get(distanceUnits);
        for (let layer of other.layers ?? []) {
            if ('source' in layer) {
                if (layer.source == 'contours_m' && units === 'imperial') continue;
                if (layer.source == 'contours_ft' && units !== 'imperial') continue;
            }
            if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
                const textField = layer.layout['text-field'];
                if (Array.isArray(textField)) {
                    if (
                        textField.length == 4 &&
                        Array.isArray(textField[3]) &&
                        textField[3][0] === 'coalesce' &&
                        Array.isArray(textField[3][1]) &&
                        textField[3][1][0] === 'get' &&
                        typeof textField[3][1][1] === 'string' &&
                        textField[3][1][1].startsWith('name')
                    ) {
                        // OpenFreeMap styles
                        layer.layout['text-field'] = [
                            'coalesce',
                            ['get', `name:${i18n.lang}`],
                            ['get', 'name'],
                        ];
                    }
                    if (
                        textField.length == 3 &&
                        textField[0] === 'coalesce' &&
                        Array.isArray(textField[1]) &&
                        textField[1][0] === 'get' &&
                        typeof textField[1][1] === 'string' &&
                        textField[1][1].startsWith('name')
                    ) {
                        // OpenMapTiles styles
                        layer.layout['text-field'] = [
                            'coalesce',
                            ['get', `name:${i18n.lang}`],
                            ['get', 'name'],
                        ];
                    }
                }
            }
            style.layers.push(layer);
        }
        if (other.sprite && !style.sprite) {
            style.sprite = other.sprite;
        }
        if (other.glyphs && !style.glyphs) {
            style.glyphs = other.glyphs;
        }
    }

    getCurrentTerrain() {
        const terrain = get(terrainSource);
        return {
            source: terrain,
            // Terrain follows the 3D mode, not the pitch: toggling it whenever pitch crossed 0 moved
            // the camera's ground elevation and rebuilt the terrain mid-gesture.
            exaggeration: get(threeD) ? 1 : 0,
        };
    }
}
