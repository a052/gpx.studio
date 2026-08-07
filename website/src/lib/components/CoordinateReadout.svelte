<script lang="ts">
    import { map } from '$lib/components/map/map';
    import { settings } from '$lib/logic/settings';
    import { i18n } from '$lib/i18n.svelte';
    import { getElevation, prefetchElevationTiles } from '$lib/utils';
    import WithUnits from '$lib/components/WithUnits.svelte';
    import * as Tooltip from '$lib/components/ui/tooltip/index.js';
    import { MapPin } from '@lucide/svelte';

    const { coordinateReadout } = settings;

    let mapInstance: maplibregl.Map | null = $state(null);

    // Cursor position and sampled elevation shown in the readout.
    let lngLat: { lat: number; lng: number } | null = $state(null);
    let elevation: number | null = $state(null);
    // Whether the current map zoom is high enough to load/show elevation.
    let elevationAvailable = $state(false);

    // Non-reactive throttling state for elevation sampling.
    let rafScheduled = false;
    let latest: maplibregl.LngLat | null = null;

    map.onLoad((m) => {
        mapInstance = m;
    });

    function refreshPrefetch() {
        if (!mapInstance) {
            return;
        }
        // Gate elevation on the map's own zoom (not a tile count) and warm the shared tile cache
        // for the visible viewport. Returns false only when zoomed out past MIN_ELEVATION_MAP_ZOOM.
        elevationAvailable = prefetchElevationTiles(
            mapInstance.getBounds(),
            mapInstance.getZoom()
        );
        if (!elevationAvailable) {
            elevation = null;
        }
    }

    function sampleElevation() {
        rafScheduled = false;
        const target = latest;
        if (!target || !elevationAvailable) {
            return;
        }
        // Always sample at getElevation's canonical z12 accuracy so the reading matches what a track
        // point here would get and does NOT change with map zoom. (Map zoom only affects prefetch.)
        getElevation([{ lat: target.lat, lon: target.lng }]).then(([ele]) => {
            // Ignore stale results if the cursor has moved on or the feature was disabled.
            if (latest === target) {
                elevation = ele;
            }
        });
    }

    function onMouseMove(e: maplibregl.MapMouseEvent) {
        latest = e.lngLat;
        lngLat = { lat: e.lngLat.lat, lng: e.lngLat.lng };
        if (elevationAvailable && !rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(sampleElevation);
        }
    }

    // Keep the last reading frozen when the cursor leaves the map canvas — do NOT blank it. The
    // overlay is pointer-events-none so the canvas keeps firing mousemove underneath it; blanking
    // on mouseout would collapse the pill and cause the earlier flicker loop.

    function onMoveEnd() {
        refreshPrefetch();
    }

    $effect(() => {
        const m = mapInstance;
        if (!m || !$coordinateReadout) {
            return;
        }

        refreshPrefetch();
        m.on('mousemove', onMouseMove);
        m.on('moveend', onMoveEnd);

        return () => {
            m.off('mousemove', onMouseMove);
            m.off('moveend', onMoveEnd);
            latest = null;
            rafScheduled = false;
            lngLat = null;
            elevation = null;
        };
    });
</script>

<!-- pointer-events-none on the wrapper so the readout text overlays the map without stealing hover
     from the canvas (which would collapse the pill and flicker); only the toggle button is interactive. -->
<div class="shrink-0 h-full flex flex-row items-center px-1 pointer-events-none">
    <div
        class="h-7 flex flex-row items-center overflow-hidden rounded-lg border border-border bg-background dark:bg-input/30 dark:border-input transition-opacity duration-300 {$coordinateReadout
            ? 'opacity-100'
            : 'opacity-70 has-[button:hover]:opacity-100'}"
    >
        <!-- Expanding readout: grows from 0 to content width when enabled (same idiom as LayerControl). -->
        <div
            class="grid transition-[grid-template-columns] duration-200 ease-out {$coordinateReadout
                ? 'grid-cols-[1fr]'
                : 'grid-cols-[0fr]'}"
        >
            <div class="overflow-hidden whitespace-nowrap">
                <div class="flex flex-row items-center gap-1.5 pl-2 pr-1 text-xs tabular-nums">
                    {#if lngLat}
                        <span>{lngLat.lat.toFixed(6)}&deg; {lngLat.lng.toFixed(6)}&deg;</span>
                        {#if elevationAvailable}
                            {#if elevation !== null}
                                <span class="text-muted-foreground">&middot;</span>
                                <WithUnits value={elevation} type="elevation" />
                            {/if}
                        {:else}
                            <span class="text-muted-foreground"
                                >&middot; {i18n._('menu.zoom_in_for_elevation')}</span
                            >
                        {/if}
                    {:else if !elevationAvailable}
                        <span class="text-muted-foreground">{i18n._('menu.zoom_in_for_elevation')}</span
                        >
                    {:else}
                        <span class="text-muted-foreground">&mdash;</span>
                    {/if}
                </div>
            </div>
        </div>
        <!-- Toggle affordance — the only interactive part. -->
        <Tooltip.Provider>
            <Tooltip.Root>
                <Tooltip.Trigger>
                    {#snippet child({ props })}
                        <button
                            {...props}
                            aria-label={i18n._('menu.coordinate_readout')}
                            class="w-7 h-7 shrink-0 flex items-center justify-center pointer-events-auto"
                            onclick={() => {
                                $coordinateReadout = !$coordinateReadout;
                            }}
                        >
                            <MapPin
                                size="16"
                                color={$coordinateReadout ? '#33b5e5' : 'currentColor'}
                            />
                        </button>
                    {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content side="top">
                    <span>{i18n._('menu.coordinate_readout')}</span>
                </Tooltip.Content>
            </Tooltip.Root>
        </Tooltip.Provider>
    </div>
</div>
