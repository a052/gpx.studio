<script lang="ts" module>
    enum CleanType {
        INSIDE = 'inside',
        OUTSIDE = 'outside',
    }
</script>

<script lang="ts">
    import { Label } from '$lib/components/ui/label/index.js';
    import { Checkbox } from '$lib/components/ui/checkbox';
    import * as RadioGroup from '$lib/components/ui/radio-group';
    import { Button } from '$lib/components/ui/button';
    import Help from '$lib/components/Help.svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { onDestroy, onMount } from 'svelte';
    import { getURLForLanguage } from '$lib/utils';
    import { Trash2 } from '@lucide/svelte';
    import { map } from '$lib/components/map/map';
    import type { GeoJSONSource } from 'maplibre-gl';
    import type * as maplibregl from 'maplibre-gl';
    import type * as GeoJSON from 'geojson';
    import { selection } from '$lib/logic/selection';
    import { fileActions } from '$lib/logic/file-actions';
    import { mapCursor, MapCursorState } from '$lib/logic/map-cursor';
    import { ANCHOR_LAYER_KEY } from '$lib/components/map/style';

    let props: {
        class?: string;
    } = $props();

    let cleanType = $state(CleanType.INSIDE);
    let deleteTrackpoints = $state(true);
    let deleteWaypoints = $state(true);
    let rectangleCoordinates: maplibregl.LngLat[] = $state([]);

    $effect(() => {
        if ($map) {
            if (rectangleCoordinates.length != 2) {
                if ($map.getLayer('rectangle')) {
                    $map.removeLayer('rectangle');
                }
            } else {
                let data: GeoJSON.Feature = {
                    type: 'Feature',
                    geometry: {
                        type: 'Polygon',
                        coordinates: [
                            [
                                [rectangleCoordinates[0].lng, rectangleCoordinates[0].lat],
                                [rectangleCoordinates[1].lng, rectangleCoordinates[0].lat],
                                [rectangleCoordinates[1].lng, rectangleCoordinates[1].lat],
                                [rectangleCoordinates[0].lng, rectangleCoordinates[1].lat],
                                [rectangleCoordinates[0].lng, rectangleCoordinates[0].lat],
                            ],
                        ],
                    },
                    properties: {},
                };
                let source: GeoJSONSource | undefined = $map.getSource('rectangle');
                if (source) {
                    source.setData(data);
                } else {
                    $map.addSource('rectangle', {
                        type: 'geojson',
                        data: data,
                    });
                }
                if (!$map.getLayer('rectangle')) {
                    $map.addLayer(
                        {
                            id: 'rectangle',
                            type: 'fill',
                            source: 'rectangle',
                            paint: {
                                'fill-color': 'SteelBlue',
                                'fill-opacity': 0.5,
                            },
                        },
                        ANCHOR_LAYER_KEY.interactions
                    );
                }
            }
        }
    });

    let dragging = false;
    let moved = false;

    function startRectangle(lngLat: maplibregl.LngLat) {
        dragging = true;
        moved = false;
        rectangleCoordinates = [lngLat, lngLat];
    }

    function updateRectangle(lngLat: maplibregl.LngLat) {
        moved = true;
        rectangleCoordinates[1] = lngLat;
    }

    function endRectangle() {
        if (dragging && !moved) {
            // A click without a drag leaves a zero-area rectangle, which enables the delete button
            // and which "Delete outside selection" reads as "delete every point".
            rectangleCoordinates = [];
        }
        dragging = false;
    }

    // The rectangle is drawn with the right button (like the elevation profile selection) so that
    // the left button keeps panning the map, which is why nothing here disables dragPan.
    function onMouseDown(e: maplibregl.MapMouseEvent) {
        if (e.originalEvent.button !== 2) {
            return;
        }
        // Marks the map event as handled, which makes MapLibre reset the remaining handlers for this
        // dispatch: rotate and pitch own the right button when 3D is on, and the contextmenu that
        // would otherwise open the coordinates popup on release is swallowed as well.
        e.preventDefault();
        startRectangle(e.lngLat);
    }

    function onMouseMove(e: maplibregl.MapMouseEvent) {
        if (!dragging) {
            return;
        }
        if ((e.originalEvent.buttons & 2) === 0) {
            // The right button was released outside the canvas, for which the map fires no mouseup:
            // end the drag instead of letting the rectangle follow the cursor back in.
            endRectangle();
            return;
        }
        updateRectangle(e.lngLat);
    }

    function onTouchStart(e: maplibregl.MapTouchEvent) {
        if (e.points.length !== 1) {
            // Hand a second finger to MapLibre so two-finger panning and pinch-zooming still work.
            endRectangle();
            return;
        }
        e.preventDefault(); // blocks the one-finger pan for this gesture only, as above
        startRectangle(e.lngLat);
    }

    function onTouchMove(e: maplibregl.MapTouchEvent) {
        if (!dragging || e.points.length !== 1) {
            return;
        }
        updateRectangle(e.lngLat);
    }

    onMount(() => {
        if ($map) {
            mapCursor.notify(MapCursorState.TOOL_WITH_CROSSHAIR, true);
            $map.on('mousedown', onMouseDown);
            $map.on('mousemove', onMouseMove);
            $map.on('mouseup', endRectangle);
            $map.on('touchstart', onTouchStart);
            $map.on('touchmove', onTouchMove);
            $map.on('touchend', endRectangle);
        }
    });

    onDestroy(() => {
        if ($map) {
            mapCursor.notify(MapCursorState.TOOL_WITH_CROSSHAIR, false);
            $map.off('mousedown', onMouseDown);
            $map.off('mousemove', onMouseMove);
            $map.off('mouseup', endRectangle);
            $map.off('touchstart', onTouchStart);
            $map.off('touchmove', onTouchMove);
            $map.off('touchend', endRectangle);

            if ($map.getLayer('rectangle')) {
                $map.removeLayer('rectangle');
            }
            if ($map.getSource('rectangle')) {
                $map.removeSource('rectangle');
            }
        }
    });

    let validSelection = $derived($selection.size > 0);
</script>

<div class="flex flex-col gap-3 w-full max-w-80 items-center {props.class ?? ''}">
    <fieldset class="flex flex-col gap-3">
        <div class="flex flex-row items-center gap-[6.4px] h-3">
            <Checkbox id="delete-trkpt" bind:checked={deleteTrackpoints} class="scale-90" />
            <Label for="delete-trkpt">
                {i18n._('toolbar.clean.delete_trackpoints')}
            </Label>
        </div>
        <div class="flex flex-row items-center gap-[6.4px] h-3">
            <Checkbox id="delete-wpt" bind:checked={deleteWaypoints} class="scale-90" />
            <Label for="delete-wpt">
                {i18n._('toolbar.clean.delete_waypoints')}
            </Label>
        </div>
        <RadioGroup.Root bind:value={cleanType}>
            <Label class="flex flex-row items-center gap-2">
                <RadioGroup.Item value={CleanType.INSIDE} />
                {i18n._('toolbar.clean.delete_inside')}
            </Label>
            <Label class="flex flex-row items-center gap-2">
                <RadioGroup.Item value={CleanType.OUTSIDE} />
                {i18n._('toolbar.clean.delete_outside')}
            </Label>
        </RadioGroup.Root>
    </fieldset>
    <Button
        variant="outline"
        class="w-full"
        disabled={!validSelection || rectangleCoordinates.length != 2}
        onclick={() => {
            fileActions.cleanSelection(
                [
                    {
                        lat: Math.min(rectangleCoordinates[0].lat, rectangleCoordinates[1].lat),
                        lon: Math.min(rectangleCoordinates[0].lng, rectangleCoordinates[1].lng),
                    },
                    {
                        lat: Math.max(rectangleCoordinates[0].lat, rectangleCoordinates[1].lat),
                        lon: Math.max(rectangleCoordinates[0].lng, rectangleCoordinates[1].lng),
                    },
                ],
                cleanType === CleanType.INSIDE,
                deleteTrackpoints,
                deleteWaypoints
            );
            rectangleCoordinates = [];
        }}
    >
        <Trash2 size="16" />
        {i18n._('toolbar.clean.button')}
    </Button>
    <Help link={getURLForLanguage(i18n.lang, '/help/toolbar/clean')}>
        {#if validSelection}
            {i18n._('toolbar.clean.help')}
        {:else}
            {i18n._('toolbar.clean.help_no_selection')}
        {/if}
    </Help>
</div>
