import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// maplibre-gl 6 loads its worker from a sibling file resolved against `import.meta.url` at runtime,
// which no bundler can see. After bundling that URL points at an app chunk, so the worker 404s and
// every worker-side job (vector tile parsing, raster-DEM decoding) hangs forever with no error —
// 3D terrain silently stays flat. Hand the bundled worker URL over before any map is constructed.
// `?worker&url` (not plain `?url`) is required: the dist worker imports `maplibre-gl-shared.mjs`,
// which only Vite's worker pipeline emits alongside it in production builds.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import MaplibreGeocoder, {
    type MaplibreGeocoderFeatureResults,
} from '@maplibre/maplibre-gl-geocoder';
import '@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css';
import { get, writable, type Writable } from 'svelte/store';
import { settings } from '$lib/logic/settings';
import { tick } from 'svelte';
import { ANCHOR_LAYER_KEY, StyleManager, SKY } from '$lib/components/map/style';
import { MapLayerEventManager } from '$lib/components/map/map-layer-event-manager';

const {
    treeFileView,
    elevationProfile,
    bottomPanelSize,
    rightPanelSize,
    distanceUnits,
    threeD,
    projection,
} = settings;

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const fitBoundsOptions: maplibregl.MapOptions['fitBoundsOptions'] = {
    maxZoom: 15,
    linear: true,
    easing: () => 1,
};

// Same cap as the MapLibre 3D terrain example. Beyond it the camera looks past the horizon, which
// multiplies the tiles to load and makes rotate-around-centre degenerate (the centre ray misses the
// ground), which is what made right-drag jump.
const MAX_PITCH = 85;

export class MapLibreGLMap {
    private _map: maplibregl.Map | null = null;
    private _mapStore: Writable<maplibregl.Map | null> = writable(null);
    private _styleManager: StyleManager | null = null;
    private _onLoadCallbacks: ((map: maplibregl.Map) => void)[] = [];
    private _unsubscribes: (() => void)[] = [];
    private callOnLoadBinded: () => void = this.callOnLoad.bind(this);
    public layerEventManager: MapLayerEventManager | null = null;

    subscribe(run: (value: maplibregl.Map | null) => void, invalidate?: () => void) {
        return this._mapStore.subscribe(run, invalidate);
    }

    init(language: string, hash: boolean, geocoder: boolean, geolocate: boolean) {
        this._styleManager = new StyleManager(this._mapStore);
        const map = new maplibregl.Map({
            container: 'map',
            style: {
                version: 8,
                projection: {
                    type: get(projection),
                },
                // Seed the Sky at construction (blue defaults + lighter fog, see SKY in style.ts).
                // Without a sky here `new Sky(undefined)` seeds every color to transparent, and the
                // later `setStyle`/`setSky` from buildStyle only overwrites the keys it is given —
                // so the sky rendered white. Keep this in sync with buildStyle's `sky`.
                sky: SKY,
                sources: {},
                layers: [],
            },
            center: [-98, 38],
            zoom: 3.85,
            hash: hash,
            boxZoom: false,
            maxPitch: MAX_PITCH,
        });
        this.layerEventManager = new MapLayerEventManager(map);
        map.addControl(
            new maplibregl.NavigationControl({
                visualizePitch: true,
            })
        );
        // Globe/flat switch. The control only calls map.setProjection(), so mirror its result into the
        // setting to survive style rebuilds and reloads.
        map.addControl(new maplibregl.GlobeControl());
        map.on('projectiontransition', () => {
            // getProjection() reports the *configured* projection, so the automatic globe → mercator
            // blend at high zoom (which also fires this event) cannot corrupt the stored value.
            const type = map.getProjection()?.type;
            if (type === 'globe' || type === 'mercator') {
                projection.set(type);
            }
        });
        if (geocoder) {
            const geocoder = new MaplibreGeocoder(
                {
                    forwardGeocode: async (config) => {
                        const results: MaplibreGeocoderFeatureResults = {
                            features: [],
                            type: 'FeatureCollection',
                        };
                        try {
                            const request = `https://nominatim.openstreetmap.org/search?format=json&q=${config.query}&limit=5&accept-language=${language}`;
                            const response = await fetch(request);
                            const geojson = await response.json();
                            results.features = geojson.map((result: any) => {
                                return {
                                    type: 'Feature',
                                    geometry: {
                                        type: 'Point',
                                        coordinates: [result.lon, result.lat],
                                    },
                                    place_name: result.display_name,
                                };
                            });
                        } catch {
                            /* ignore */
                        }
                        return results;
                    },
                },
                {
                    maplibregl: maplibregl,
                    enableEventLogging: false,
                    collapsed: true,
                    flyTo: fitBoundsOptions,
                    language,
                }
            );
            map.addControl(geocoder);
        }
        if (geolocate) {
            map.addControl(
                new maplibregl.GeolocateControl({
                    positionOptions: {
                        enableHighAccuracy: true,
                    },
                    fitBoundsOptions,
                    trackUserLocation: true,
                })
            );
        }
        const scaleControl = new maplibregl.ScaleControl({
            unit: get(distanceUnits),
        });
        map.addControl(scaleControl);
        map.on('load', () => {
            this._map = map;
            this._mapStore.set(map); // only set the store after the map has loaded
            window._map = map; // entry point for extensions
            this.resize();
            scaleControl.setUnit(get(distanceUnits));
            // A pitched camera restored from the URL hash (shared/embed links) implies 3D,
            // even if the stored setting says otherwise. Persist it so the menu checkbox agrees.
            const enable3D = map.getPitch() !== 0 || get(threeD);
            if (enable3D !== get(threeD)) {
                threeD.set(enable3D);
            }
            // Gate all tilt/rotation handlers on the setting. threeD.set() persists through the
            // DB asynchronously, so the subscription's first (synchronous) emission can still
            // carry the pre-reconcile value — apply the reconciled state to it.
            let initial = true;
            this._unsubscribes.push(
                threeD.subscribe((enabled) => {
                    this.applyThreeD(initial ? enable3D : enabled);
                    initial = false;
                })
            );
        });
        map.on('style.load', this.callOnLoadBinded);

        this._unsubscribes.push(treeFileView.subscribe(() => this.resize()));
        this._unsubscribes.push(elevationProfile.subscribe(() => this.resize()));
        this._unsubscribes.push(bottomPanelSize.subscribe(() => this.resize()));
        this._unsubscribes.push(rightPanelSize.subscribe(() => this.resize()));
        this._unsubscribes.push(
            distanceUnits.subscribe((units) => {
                scaleControl.setUnit(units);
            })
        );
    }

    destroy() {
        if (this._map) {
            this._map.remove();
            this._mapStore.set(null);
        }
        this._unsubscribes.forEach((unsubscribe) => unsubscribe());
        this._unsubscribes = [];
    }

    resize() {
        if (this._map) {
            tick().then(() => {
                this._map?.resize();
            });
        }
    }

    toggle3D() {
        threeD.set(!get(threeD));
    }

    private applyThreeD(enabled: boolean) {
        const map = this._map;
        if (!map) return;
        if (enabled) {
            map.setMaxPitch(MAX_PITCH);
            map.dragRotate.enable();
            map.touchPitch.enable();
            map.touchZoomRotate.enableRotation();
            map.keyboard.enableRotation();
            if (map.getPitch() === 0) {
                map.easeTo({ pitch: 70 });
            }
        } else {
            map.dragRotate.disable();
            map.touchPitch.disable();
            map.touchZoomRotate.disableRotation();
            map.keyboard.disableRotation();
            if (map.getPitch() !== 0 || map.getBearing() !== 0) {
                map.easeTo({ pitch: 0, bearing: 0 });
                // Clamp once flat so the nav-control pitch drag can't tilt either. Guard
                // against a rapid re-enable landing this stale callback while 3D is on again.
                map.once('moveend', () => {
                    if (!get(threeD)) {
                        map.setMaxPitch(0);
                    }
                });
            } else {
                map.setMaxPitch(0);
            }
        }
    }

    onLoad(callback: (map: maplibregl.Map) => void) {
        if (this._map) {
            callback(this._map);
        } else {
            this._onLoadCallbacks.push(callback);
        }
    }

    callOnLoad() {
        if (this._map && this._map.getLayer(ANCHOR_LAYER_KEY.overlays)) {
            this._onLoadCallbacks.forEach((callback) => callback(this._map!));
            this._onLoadCallbacks = [];
            this._map.off('style.load', this.callOnLoadBinded);
        }
    }
}

export const map = new MapLibreGLMap();
