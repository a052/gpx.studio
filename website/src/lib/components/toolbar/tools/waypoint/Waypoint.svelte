<script lang="ts">
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Label } from '$lib/components/ui/label/index.js';
    import { Button } from '$lib/components/ui/button';
    import * as Select from '$lib/components/ui/select';
    import { i18n } from '$lib/i18n.svelte';
    import { ListWaypointItem } from '$lib/components/file-list/file-list';
    import Help from '$lib/components/Help.svelte';
    import { onDestroy, onMount, untrack } from 'svelte';
    import { getURLForLanguage, getElevation } from '$lib/utils';
    import { Bookmark, CircleX, Maximize2, Minimize2, Save } from '@lucide/svelte';
    import { getSymbolKey, symbols } from '$lib/assets/symbols';
    import { selection } from '$lib/logic/selection';
    import { selectedWaypoint } from './waypoint';
    import { fileActions } from '$lib/logic/file-actions';
    import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
    import { CalendarDate, type DateValue } from '@internationalized/date';
    import { settings } from '$lib/logic/settings';
    import {
        getConvertedElevation,
        getConvertedElevationToMeters,
        getElevationUnits,
    } from '$lib/units';
    import { map } from '$lib/components/map/map';
    import { mapCursor, MapCursorState } from '$lib/logic/map-cursor';
    import * as maplibregl from 'maplibre-gl';
    import { getSvgForSymbol } from '$lib/components/map/gpx-layer/gpx-layer';

    let props: {
        class?: string;
    } = $props();

    let name = $state('');
    let description = $state('');
    let link = $state('');
    let sym = $state('');
    // null while a coordinate input is empty — Svelte's number binding maps '' to null.
    let longitude: number | null = $state(0);
    let latitude: number | null = $state(0);
    // Elevation is kept in the display units; null = empty (auto-fetch from DEM on save).
    let elevation: number | null = $state(null);
    let waypointDate: DateValue | undefined = $state(undefined);
    let waypointTime: string | undefined = $state(undefined);
    // Whether the description textarea is enlarged in place for easier editing.
    let expanded = $state(false);
    let symbolKey = $derived(getSymbolKey(sym));

    const { distanceUnits } = settings;

    // Same pure helpers as the Time tool: DatePicker works with DateValue, GPX with Date.
    function toCalendarDate(date: Date): CalendarDate {
        return new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
    }

    function toTimeString(date: Date): string {
        return date.toTimeString().split(' ')[0];
    }

    function getDate(date: DateValue, time: string): Date {
        let [hours, minutes, seconds] = time.split(':').map((x) => parseInt(x));
        if (seconds === undefined) {
            seconds = 0;
        }
        return new Date(date.year, date.month - 1, date.day, hours, minutes, seconds);
    }

    let canCreate = $derived($selection.size > 0);

    let sortedSymbols = $derived(
        Object.entries(symbols).sort((a, b) => {
            return i18n
                ._(`gpx.symbol.${a[0]}`)
                .localeCompare(i18n._(`gpx.symbol.${b[0]}`), i18n.lang);
        })
    );

    let marker: maplibregl.Marker | null = null;

    // Guards the asynchronous DEM fetch started by map clicks: incremented whenever the form is
    // repopulated or cleared, so a late-resolving fetch can't overwrite the fresh values.
    let elevationRequestId = 0;

    function reset() {
        elevationRequestId++;
        if ($selectedWaypoint) {
            selectedWaypoint.reset();
        } else {
            name = '';
            description = '';
            link = '';
            sym = '';
            longitude = 0;
            latitude = 0;
            elevation = null;
            waypointDate = undefined;
            waypointTime = undefined;
        }
    }

    $effect(() => {
        // Repopulating from a waypoint supersedes any in-flight elevation fetch.
        elevationRequestId++;
        if ($selectedWaypoint) {
            const wpt = $selectedWaypoint[0];
            untrack(() => {
                name = wpt.name ?? '';
                description = wpt.desc ?? '';
                if (wpt.cmt !== undefined && wpt.cmt !== wpt.desc) {
                    description += '\n\n' + wpt.cmt;
                }
                link = wpt.link?.attributes?.href ?? '';
                sym = wpt.sym ?? '';
                longitude = parseFloat(wpt.getLongitude().toFixed(6));
                latitude = parseFloat(wpt.getLatitude().toFixed(6));
                elevation =
                    wpt.ele !== undefined
                        ? parseFloat(getConvertedElevation(wpt.ele).toFixed(2))
                        : null;
                if (wpt.time) {
                    waypointDate = toCalendarDate(wpt.time);
                    waypointTime = toTimeString(wpt.time);
                } else {
                    waypointDate = undefined;
                    waypointTime = undefined;
                }
            });
        } else {
            untrack(reset);
        }
    });

    function createOrUpdateWaypoint() {
        if (latitude === null || longitude === null) {
            return; // a coordinate input is empty — nothing valid to save
        }
        latitude = parseFloat(latitude.toFixed(6));
        longitude = parseFloat(longitude.toFixed(6));

        fileActions.addOrUpdateWaypoint(
            {
                attributes: {
                    lat: latitude,
                    lon: longitude,
                },
                name: name.length > 0 ? name : undefined,
                desc: description.length > 0 ? description : undefined,
                cmt: description.length > 0 ? description : undefined,
                link: link.length > 0 ? { attributes: { href: link } } : undefined,
                sym: sym.length > 0 ? sym : undefined,
                ele: elevation !== null ? getConvertedElevationToMeters(elevation) : undefined,
                time: waypointDate ? getDate(waypointDate, waypointTime ?? '00:00:00') : undefined,
            },
            selectedWaypoint.wpt && selectedWaypoint.fileId
                ? new ListWaypointItem(selectedWaypoint.fileId, selectedWaypoint.wpt._data.index)
                : undefined
        );

        reset();
    }

    function setCoordinates(e: maplibregl.MapMouseEvent) {
        latitude = parseFloat(e.lngLat.lat.toFixed(6));
        longitude = parseFloat(e.lngLat.lng.toFixed(6));

        // Clicking an existing waypoint loads its own elevation (or empty if it has none) via
        // the prefill effect — don't let a DEM fetch overwrite it. The hit test mirrors the one
        // the layer event manager uses to decide whether its waypoint click handlers fire.
        const features = e.target.queryRenderedFeatures(e.point);
        if (features.some((f) => f.layer?.id.endsWith('-waypoints'))) {
            return;
        }

        // A fresh click supersedes any earlier in-flight fetch.
        const requestId = ++elevationRequestId;
        getElevation([{ lat: latitude, lon: longitude }]).then((elevationFromDEM) => {
            if (requestId !== elevationRequestId) return;
            elevation = parseFloat(getConvertedElevation(elevationFromDEM[0]).toFixed(2));
        });
    }

    $effect(() => {
        if ($selectedWaypoint) {
            if (marker) {
                marker.remove();
                marker = null;
            }
        } else if (latitude === null || longitude === null) {
            // A coordinate input is mid-edit: leave the marker where it is rather than letting
            // the missing value coerce to 0 and jump it to the equator.
        } else if (latitude !== 0 || longitude !== 0) {
            if ($map) {
                if (marker) {
                    marker.setLngLat([longitude, latitude]).getElement().innerHTML =
                        getSvgForSymbol(symbolKey);
                } else {
                    let element = document.createElement('div');
                    element.classList.add('w-8', 'h-8');
                    element.innerHTML = getSvgForSymbol(symbolKey);
                    marker = new maplibregl.Marker({
                        element,
                        anchor: 'bottom',
                    })
                        .setLngLat([longitude, latitude])
                        .addTo($map);
                }
            }
        } else {
            if (marker) {
                marker.remove();
                marker = null;
            }
        }
    });

    onMount(() => {
        if ($map) {
            $map.on('click', setCoordinates);
            mapCursor.notify(MapCursorState.TOOL_WITH_CROSSHAIR, true);
        }
    });

    onDestroy(() => {
        if ($map) {
            $map.off('click', setCoordinates);
            mapCursor.notify(MapCursorState.TOOL_WITH_CROSSHAIR, false);
        }
        if (marker) {
            marker.remove();
            marker = null;
        }
    });
</script>

<div class="flex flex-col gap-3 w-full max-w-96 {props.class ?? ''}">
    <fieldset class="flex flex-col gap-1.5">
        <div class="flex flex-col gap-1">
            <Label for="name">{i18n._('menu.metadata.name')}</Label>
            <Input
                bind:value={name}
                id="name"
                class="font-semibold"
                disabled={!canCreate && !$selectedWaypoint}
            />
        </div>
        <div class="flex flex-col gap-1">
            <Label for="description">{i18n._('menu.metadata.description')}</Label>
            <div class="relative">
                <Textarea
                    bind:value={description}
                    id="description"
                    disabled={!canCreate && !$selectedWaypoint}
                    class="field-sizing-fixed min-w-0 w-full h-[4.5rem] {expanded
                        ? 'h-[min(30vh,12rem)]'
                        : ''} py-1.5 px-3 pr-9 text-sm resize-none"
                />
                <Button
                    variant="ghost"
                    size="icon-sm"
                    class="absolute right-2.5 bottom-1.5 size-6 text-muted-foreground"
                    title={expanded
                        ? i18n._('toolbar.waypoint.collapse_description')
                        : i18n._('toolbar.waypoint.expand_description')}
                    aria-label={expanded
                        ? i18n._('toolbar.waypoint.collapse_description')
                        : i18n._('toolbar.waypoint.expand_description')}
                    disabled={!canCreate && !$selectedWaypoint}
                    onclick={() => (expanded = !expanded)}
                >
                    {#if expanded}
                        <Minimize2 size="14" />
                    {:else}
                        <Maximize2 size="14" />
                    {/if}
                </Button>
            </div>
        </div>
        <div class="flex flex-col gap-1">
            <Label for="symbol">{i18n._('toolbar.waypoint.icon')}</Label>
            <Select.Root bind:value={sym} type="single">
                <Select.Trigger
                    id="symbol"
                    class="w-full"
                    disabled={!canCreate && !$selectedWaypoint}
                >
                    <span class="flex flex-row gap-1.5 items-center">
                        {#if symbolKey}
                            {#if symbols[symbolKey].icon}
                                {@const Component = symbols[symbolKey].icon}
                                <Component size="14" />
                            {/if}
                            {i18n._(`gpx.symbol.${symbolKey}`)}
                        {:else}
                            {sym}
                        {/if}
                    </span>
                </Select.Trigger>
                <Select.Content class="max-h-60">
                    {#each sortedSymbols as [key, symbol] (key)}
                        <Select.Item value={symbol.value}>
                            <span>
                                {#if symbol.icon}
                                    {@const Component = symbol.icon}
                                    <Component size="14" class="inline-block align-sub" />
                                {:else}
                                    <span class="w-4 inline-block"></span>
                                {/if}
                                {i18n._(`gpx.symbol.${key}`)}
                            </span>
                        </Select.Item>
                    {/each}
                </Select.Content>
            </Select.Root>
        </div>
        <div class="flex flex-col gap-1">
            <Label for="link">{i18n._('toolbar.waypoint.link')}</Label>
            <Input
                bind:value={link}
                id="link"
                class="h-8"
                disabled={!canCreate && !$selectedWaypoint}
            />
        </div>
        <div class="flex flex-row gap-1.5">
            <div class="grow basis-0 flex flex-col gap-1">
                <Label for="latitude">{i18n._('toolbar.waypoint.latitude')}</Label>
                <Input
                    bind:value={latitude}
                    type="number"
                    id="latitude"
                    step={1e-6}
                    min={-90}
                    max={90}
                    class="text-xs h-8"
                    disabled={!canCreate && !$selectedWaypoint}
                />
            </div>
            <div class="grow basis-0 flex flex-col gap-1">
                <Label for="longitude">{i18n._('toolbar.waypoint.longitude')}</Label>
                <Input
                    bind:value={longitude}
                    type="number"
                    id="longitude"
                    step={1e-6}
                    min={-180}
                    max={180}
                    class="text-xs h-8"
                    disabled={!canCreate && !$selectedWaypoint}
                />
            </div>
            <div class="grow basis-0 flex flex-col gap-1">
                <Label for="elevation">
                    {i18n._('toolbar.waypoint.elevation')}
                    ({getElevationUnits($distanceUnits)})
                </Label>
                <Input
                    bind:value={elevation}
                    type="number"
                    id="elevation"
                    step="any"
                    class="text-xs h-8"
                    disabled={!canCreate && !$selectedWaypoint}
                />
            </div>
        </div>
        <div class="flex flex-col gap-1">
            <Label>{i18n._('toolbar.waypoint.time')}</Label>
            <div class="flex flex-row gap-1.5">
                <DatePicker
                    bind:value={waypointDate}
                    disabled={!canCreate && !$selectedWaypoint}
                    locale={i18n.lang}
                    placeholder={i18n._('toolbar.time.pick_date')}
                    class="grow"
                />
                <Input
                    type="time"
                    step={1}
                    bind:value={waypointTime}
                    class="w-fit"
                    disabled={!canCreate && !$selectedWaypoint}
                />
            </div>
        </div>
    </fieldset>
    <div class="flex flex-row gap-1.5 items-center">
        <Button
            variant="outline"
            disabled={(!canCreate && !$selectedWaypoint) || latitude === null || longitude === null}
            class="grow shrink h-fit min-h-8 whitespace-normal py-1"
            onclick={createOrUpdateWaypoint}
        >
            {#if $selectedWaypoint}
                <Save size="16" class="shrink-0" />
                {i18n._('menu.metadata.save')}
            {:else}
                <Bookmark size="16" class="shrink-0" />
                {i18n._('toolbar.waypoint.create')}
            {/if}
        </Button>
        <Button variant="outline" size="icon" onclick={reset}>
            <CircleX size="16" />
        </Button>
    </div>
    <Help link={getURLForLanguage(i18n.lang, '/help/toolbar/waypoint')}>
        {#if $selectedWaypoint || canCreate}
            {i18n._('toolbar.waypoint.help')}
        {:else}
            {i18n._('toolbar.waypoint.help_no_selection')}
        {/if}
    </Help>
</div>
