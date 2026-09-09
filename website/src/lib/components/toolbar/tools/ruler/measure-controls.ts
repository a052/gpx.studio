import { distance, type Coordinates } from 'gpx';
import { get } from 'svelte/store';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import { mapCursor, MapCursorState } from '$lib/logic/map-cursor';
import { ANCHOR_LAYER_KEY } from '$lib/components/map/style';
import type { MapLayerEventManager } from '$lib/components/map/map-layer-event-manager';
import { getDistanceWithUnits } from '$lib/units';
import { measurePoints, measureTotalKm } from './measure';

const LINE_LAYER = 'measure-line';
const POINT_LAYER = 'measure-points';

// Owns every map interaction for the ruler tool. Created by `Ruler.svelte` on mount and torn down
// on destroy. Nothing here touches the GPX/Dexie layer — the polyline is a pure display overlay
// whose vertices live in the `measurePoints` store.
export class MeasureControls {
    map: maplibregl.Map;
    layerEventManager: MapLayerEventManager;

    // Current cursor position, used to draw the "rubber band" segment from the last placed point to
    // the pointer and to size the live segment-length popup.
    private cursor: Coordinates | null = null;
    // Index of the vertex currently being dragged, or null when not dragging.
    private draggedIndex: number | null = null;

    private popup: maplibregl.Popup;

    private unsubscribe: (() => void) | undefined;

    private onClickBinded = this.onClick.bind(this);
    private onMouseMoveBinded = this.onMouseMove.bind(this);
    private onMouseOutBinded = this.onMouseOut.bind(this);
    private onContextMenuBinded = this.onContextMenu.bind(this);
    private onVertexMouseDownBinded = this.onVertexMouseDown.bind(this);
    private onVertexTouchStartBinded = this.onVertexTouchStart.bind(this);
    private onVertexMouseEnterBinded = this.onVertexMouseEnter.bind(this);
    private onVertexMouseLeaveBinded = this.onVertexMouseLeave.bind(this);
    private onDragMoveBinded = this.onDragMove.bind(this);
    private onDragEndBinded = this.onDragEnd.bind(this);
    private onPointsChangedBinded = this.onPointsChanged.bind(this);

    constructor(map: maplibregl.Map, layerEventManager: MapLayerEventManager) {
        this.map = map;
        this.layerEventManager = layerEventManager;
        this.popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            className: 'measure-popup',
        });

        mapCursor.notify(MapCursorState.TOOL_WITH_CROSSHAIR, true);

        this.map.on('click', this.onClickBinded);
        this.map.on('mousemove', this.onMouseMoveBinded);
        this.map.on('mouseout', this.onMouseOutBinded);
        this.map.on('contextmenu', this.onContextMenuBinded);

        this.layerEventManager.on('mousedown', POINT_LAYER, this.onVertexMouseDownBinded);
        this.layerEventManager.on('touchstart', POINT_LAYER, this.onVertexTouchStartBinded);
        this.layerEventManager.on('mouseenter', POINT_LAYER, this.onVertexMouseEnterBinded);
        this.layerEventManager.on('mouseleave', POINT_LAYER, this.onVertexMouseLeaveBinded);

        // `measurePoints` is the single source of truth. Recompute the total and re-render on every
        // change, whichever the origin — a click/drag here, or Clear/Backspace from the panel. The
        // subscription fires immediately, which also performs the initial render.
        this.unsubscribe = measurePoints.subscribe(this.onPointsChangedBinded);
    }

    private onPointsChanged(points: Coordinates[]) {
        let total = 0;
        for (let i = 1; i < points.length; i++) {
            total += distance(points[i - 1], points[i]) / 1000; // distance() is meters; stores use km
        }
        measureTotalKm.set(total);
        this.render();
    }

    private setPoints(points: Coordinates[]) {
        measurePoints.set(points);
    }

    private vertexIndexAt(point: maplibregl.Point): number | null {
        if (!this.map.getLayer(POINT_LAYER)) {
            return null;
        }
        const features = this.map.queryRenderedFeatures(point, { layers: [POINT_LAYER] });
        if (features.length > 0 && features[0].properties) {
            return features[0].properties.index as number;
        }
        return null;
    }

    private onClick(e: maplibregl.MapMouseEvent) {
        if (this.draggedIndex !== null) {
            return;
        }
        // A click that lands on an existing vertex removes it rather than stacking a new point on top.
        const index = this.vertexIndexAt(e.point);
        if (index !== null) {
            const points = get(measurePoints).slice();
            points.splice(index, 1);
            this.setPoints(points);
            return;
        }
        this.setPoints([...get(measurePoints), { lat: e.lngLat.lat, lon: e.lngLat.lng }]);
    }

    private onContextMenu(e: maplibregl.MapMouseEvent) {
        const index = this.vertexIndexAt(e.point);
        if (index === null) {
            return;
        }
        // Swallow the event so the coordinates popup does not open on top of the removal.
        e.preventDefault();
        const points = get(measurePoints).slice();
        points.splice(index, 1);
        this.setPoints(points);
    }

    private onMouseMove(e: maplibregl.MapMouseEvent) {
        this.cursor = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        this.render();
        this.updatePopup(e.lngLat);
    }

    private onMouseOut() {
        this.cursor = null;
        this.popup.remove();
        this.render();
    }

    private updatePopup(lngLat: maplibregl.LngLat) {
        const points = get(measurePoints);
        if (points.length === 0 || this.draggedIndex !== null) {
            this.popup.remove();
            return;
        }
        const last = points[points.length - 1];
        const segmentKm = distance(last, { lat: lngLat.lat, lon: lngLat.lng }) / 1000;
        this.popup.setText(getDistanceWithUnits(segmentKm));
        this.popup.setLngLat(lngLat).addTo(this.map);
    }

    // --- Vertex dragging (mirrors the routing tool's anchor drag) ---

    private onVertexMouseDown(e: maplibregl.MapLayerMouseEvent) {
        e.preventDefault();
        this.map.dragPan.disable();
        this.draggedIndex = e.features![0].properties!.index as number;
        this.popup.remove();
        this.map.on('mousemove', this.onDragMoveBinded);
        this.map.once('mouseup', this.onDragEndBinded);
    }

    private onVertexTouchStart(e: maplibregl.MapLayerTouchEvent) {
        if (e.points.length !== 1) {
            return;
        }
        e.preventDefault();
        this.map.dragPan.disable();
        this.draggedIndex = e.features![0].properties!.index as number;
        this.popup.remove();
        this.map.on('touchmove', this.onDragMoveBinded);
        this.map.once('touchend', this.onDragEndBinded);
    }

    private onDragMove(e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) {
        if (this.draggedIndex === null) {
            return;
        }
        mapCursor.notify(MapCursorState.ANCHOR_DRAGGING, true);
        const points = get(measurePoints).slice();
        points[this.draggedIndex] = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        this.setPoints(points);
    }

    private onDragEnd() {
        mapCursor.notify(MapCursorState.ANCHOR_DRAGGING, false);
        this.map.dragPan.enable();
        this.map.off('mousemove', this.onDragMoveBinded);
        this.map.off('touchmove', this.onDragMoveBinded);
        this.draggedIndex = null;
    }

    private onVertexMouseEnter() {
        mapCursor.notify(MapCursorState.ANCHOR_HOVER, true);
    }

    private onVertexMouseLeave() {
        mapCursor.notify(MapCursorState.ANCHOR_HOVER, false);
    }

    // --- Rendering ---

    private lineGeoJSON(): GeoJSON.Feature {
        const points = get(measurePoints);
        const coordinates = points.map((p) => [p.lon, p.lat]);
        // Extend the drawn line to the cursor so the pending segment is visible before the next click.
        if (points.length > 0 && this.cursor && this.draggedIndex === null) {
            coordinates.push([this.cursor.lon, this.cursor.lat]);
        }
        return {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: {},
        };
    }

    private pointsGeoJSON(): GeoJSON.FeatureCollection {
        return {
            type: 'FeatureCollection',
            features: get(measurePoints).map((p, index) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                properties: { index },
            })),
        };
    }

    private render() {
        try {
            const lineSource = this.map.getSource(LINE_LAYER) as GeoJSONSource | undefined;
            if (lineSource) {
                lineSource.setData(this.lineGeoJSON());
            } else {
                this.map.addSource(LINE_LAYER, { type: 'geojson', data: this.lineGeoJSON() });
            }
            if (!this.map.getLayer(LINE_LAYER)) {
                this.map.addLayer(
                    {
                        id: LINE_LAYER,
                        type: 'line',
                        source: LINE_LAYER,
                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: {
                            'line-color': '#3b82f6',
                            'line-width': 3,
                            'line-dasharray': [2, 1.5],
                        },
                    },
                    ANCHOR_LAYER_KEY.interactions
                );
            }

            const pointSource = this.map.getSource(POINT_LAYER) as GeoJSONSource | undefined;
            if (pointSource) {
                pointSource.setData(this.pointsGeoJSON());
            } else {
                this.map.addSource(POINT_LAYER, { type: 'geojson', data: this.pointsGeoJSON() });
            }
            if (!this.map.getLayer(POINT_LAYER)) {
                this.map.addLayer(
                    {
                        id: POINT_LAYER,
                        type: 'circle',
                        source: POINT_LAYER,
                        paint: {
                            'circle-radius': 5,
                            'circle-color': '#ffffff',
                            'circle-stroke-color': '#3b82f6',
                            'circle-stroke-width': 2,
                        },
                    },
                    ANCHOR_LAYER_KEY.routingControls
                );
            }
        } catch {
            // No reliable way to check if the map is ready to add sources and layers
        }
    }

    private removeLayers() {
        try {
            for (const id of [LINE_LAYER, POINT_LAYER]) {
                if (this.map.getLayer(id)) {
                    this.map.removeLayer(id);
                }
                if (this.map.getSource(id)) {
                    this.map.removeSource(id);
                }
            }
        } catch {
            // No reliable way to check if the map is ready to remove sources and layers
        }
    }

    destroy() {
        this.unsubscribe?.();

        this.map.off('click', this.onClickBinded);
        this.map.off('mousemove', this.onMouseMoveBinded);
        this.map.off('mouseout', this.onMouseOutBinded);
        this.map.off('contextmenu', this.onContextMenuBinded);
        this.map.off('mousemove', this.onDragMoveBinded);
        this.map.off('touchmove', this.onDragMoveBinded);

        this.layerEventManager.off('mousedown', POINT_LAYER, this.onVertexMouseDownBinded);
        this.layerEventManager.off('touchstart', POINT_LAYER, this.onVertexTouchStartBinded);
        this.layerEventManager.off('mouseenter', POINT_LAYER, this.onVertexMouseEnterBinded);
        this.layerEventManager.off('mouseleave', POINT_LAYER, this.onVertexMouseLeaveBinded);

        this.map.dragPan.enable();
        this.popup.remove();
        this.removeLayers();

        mapCursor.notify(MapCursorState.TOOL_WITH_CROSSHAIR, false);
        mapCursor.notify(MapCursorState.ANCHOR_HOVER, false);
        mapCursor.notify(MapCursorState.ANCHOR_DRAGGING, false);

        measurePoints.set([]);
        measureTotalKm.set(0);
    }
}
