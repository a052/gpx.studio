<script lang="ts">
    import * as Card from '$lib/components/ui/card';
    import { Button } from '$lib/components/ui/button';
    import { PencilLine, MapPin } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
    import type { WaypointType } from 'gpx';
    import type { PopupItem } from '$lib/components/map/map-popup';
    import type { OverpassPopupItem } from '$lib/components/map/layer-control/overpass-layer';
    import { fileActions } from '$lib/logic/file-actions';
    import { selection } from '$lib/logic/selection';
    import { safeImageUrl, safeLinkUrl } from '$lib/logic/sanitize';

    let {
        poi,
    }: {
        poi: PopupItem<OverpassPopupItem>;
    } = $props();

    // Since MapLibre GL JS v6, nested GeoJSON feature properties are returned as real
    // objects (previously JSON strings). Keep the string fallback for any legacy/serialized data.
    let tags: Record<string, string> = $derived.by(() => {
        if (!poi) return {};
        const t = poi.item.tags;
        return typeof t === 'string' ? JSON.parse(t) : (t ?? {});
    });
    let name = $derived.by(() => {
        if (poi) {
            if (tags.name !== undefined && tags.name !== '') {
                return tags.name;
            } else {
                return i18n._(`layers.label.${poi.item.query}`);
            }
        }
        return '';
    });

    // OpenStreetMap tags are editable by anyone and unconstrained in format, so every tag value
    // used as a URL is scheme-checked before it reaches the DOM.
    let imageUrl = $derived(safeImageUrl(tags.image ?? tags['image:0']));

    function addToFile() {
        const desc = Object.entries(tags)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n');
        let wpt: WaypointType = {
            attributes: {
                lat: poi.item.lat,
                lon: poi.item.lon,
            },
            name: name,
            desc: desc,
            cmt: desc,
            sym: poi.item.sym,
        };
        // Store the validated URL, not the raw tag: an unchecked value would be persisted in the
        // user's file, written to their exported GPX, and rendered again by the waypoint popup.
        const website = safeLinkUrl(tags.website);
        if (website) {
            wpt.link = {
                attributes: {
                    href: website,
                },
            };
        }
        fileActions.addOrUpdateWaypoint(wpt);
    }
</script>

<Card.Root class="border-none shadow-md text-base p-2 max-w-[50dvw] gap-0">
    <Card.Header class="p-0 gap-0">
        <Card.Title class="text-md flex flex-row">
            <div class="flex flex-col">
                <p>{name}</p>
                <div class="text-muted-foreground text-xs font-normal">
                    {poi.item.lat.toFixed(6)}&deg; {poi.item.lon.toFixed(6)}&deg;
                </div>
            </div>

            <Button
                class="ml-auto"
                variant="outline"
                size="icon-sm"
                href="https://www.openstreetmap.org/edit?editor=id&{poi.item.type ?? 'node'}={poi
                    .item.id}"
                target="_blank"
            >
                <PencilLine size="16" />
            </Button>
        </Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-1 p-0 text-sm whitespace-normal break-all">
        <ScrollArea class="flex flex-col max-h-[30dvh]">
            {#if imageUrl}
                <div class="w-full rounded-md overflow-clip my-2 max-w-96 mx-auto">
                    <!-- svelte-ignore a11y_missing_attribute -->
                    <img src={imageUrl} />
                </div>
            {/if}
            <div class="grid grid-cols-[auto_auto] gap-x-3">
                {#each Object.entries(tags) as [key, value] (key)}
                    {#if key !== 'name' && !key.includes('image')}
                        <span class="font-mono">{key}</span>
                        {#if key === 'website' || key.startsWith('website:') || key.endsWith(':website') || key === 'contact:facebook' || key === 'contact:instagram' || key === 'contact:twitter'}
                            {@const href = safeLinkUrl(value)}
                            {#if href}
                                <a
                                    {href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="text-link underline"
                                >
                                    {value}
                                </a>
                            {:else}
                                <span>{value}</span>
                            {/if}
                        {:else if key === 'wikipedia' || key.startsWith('wikipedia:') || key.endsWith(':wikipedia')}
                            <a
                                href="https://wikipedia.org/wiki/{value}"
                                target="_blank"
                                class="text-link underline"
                            >
                                {value}
                            </a>
                        {:else if key === 'phone' || key === 'contact:phone'}
                            <a href={'tel:' + value} class="text-link underline">{value}</a>
                        {:else if key === 'email' || key === 'contact:email'}
                            <a href={'mailto:' + value} class="text-link underline">{value}</a>
                        {:else}
                            <span>{value}</span>
                        {/if}
                    {/if}
                {/each}
            </div>
        </ScrollArea>
        <Button
            size="sm"
            class="mt-1 justify-start"
            variant="outline"
            disabled={$selection.size === 0}
            onclick={addToFile}
        >
            <MapPin size="14" />
            {i18n._('toolbar.waypoint.add')}
        </Button>
    </Card.Content>
</Card.Root>
