<script lang="ts">
    import * as Card from '$lib/components/ui/card';
    import { Button } from '$lib/components/ui/button';
    import Shortcut from '$lib/components/Shortcut.svelte';
    import CopyCoordinates from '$lib/components/map/gpx-layer/CopyCoordinates.svelte';
    import WithUnits from '$lib/components/WithUnits.svelte';
    import { Dot, ExternalLink, Trash2 } from '@lucide/svelte';
    import { currentTool, Tool } from '$lib/components/toolbar/tools';
    import { getSymbolKey, symbols } from '$lib/assets/symbols';
    import { i18n } from '$lib/i18n.svelte';
    import sanitizeHtml from 'sanitize-html';
    import { safeLinkUrl } from '$lib/logic/sanitize';
    import * as Dialog from '$lib/components/ui/dialog';
    import type { Waypoint } from 'gpx';
    import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
    import { fileActions } from '$lib/logic/file-actions';
    import type { PopupItem } from '$lib/components/map/map-popup';
    import { selection } from '$lib/logic/selection';
    import { ListFileItem } from '$lib/components/file-list/file-list';

    let {
        waypoint,
    }: {
        waypoint: PopupItem<Waypoint>;
    } = $props();

    let selected = $derived(
        waypoint.fileId ? $selection.hasAnyChildren(new ListFileItem(waypoint.fileId)) : false
    );
    let symbolKey = $derived(waypoint ? getSymbolKey(waypoint.item.sym) : undefined);
    // The <link> of a waypoint comes straight from the GPX file, so its scheme has to be checked
    // before it becomes a link target: undefined here means "render the title as plain text".
    let linkHref = $derived(safeLinkUrl(waypoint.item.link?.attributes?.href));

    function sanitize(text: string | undefined): string {
        if (text === undefined) {
            return '';
        }
        return sanitizeHtml(text, {
            allowedTags: ['a', 'br', 'img'],
            allowedAttributes: {
                a: ['href', 'target'],
                img: ['src'],
            },
        }).trim();
    }

    // Images inside the description come from {@html sanitize(...)}, so their click events can
    // only be caught via delegation; clicking one opens the full-size lightbox below.
    let lightboxSrc = $state<string | undefined>(undefined);

    function handleDescriptionClick(e: MouseEvent) {
        if (e.target instanceof HTMLImageElement) {
            // Description images are often wrapped in an <a> pointing at the image itself;
            // suppress that navigation — the lightbox below replaces it.
            e.preventDefault();
            lightboxSrc = e.target.src;
        }
    }
</script>

<Card.Root class="border-none shadow-md text-base p-2 max-w-[25dvw] gap-0">
    <Card.Header class="p-0 gap-0">
        <Card.Title class="text-md">
            {#if linkHref}
                <a href={linkHref} target="_blank" rel="noopener noreferrer">
                    {waypoint.item.name ?? linkHref}
                    <ExternalLink size="12" class="inline-block mb-1.5" />
                </a>
            {:else}
                {waypoint.item.name ?? i18n._('gpx.waypoint')}
            {/if}
        </Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col text-sm p-0">
        <div class="flex flex-row items-center text-muted-foreground text-xs whitespace-nowrap">
            {#if symbolKey}
                <span>
                    {#if symbols[symbolKey].icon}
                        {@const Icon = symbols[symbolKey].icon}
                        <Icon size="12" class="inline-block mb-1" />
                    {:else}
                        <span class="w-4 inline-block"></span>
                    {/if}
                    {i18n._(`gpx.symbol.${symbolKey}`)}
                </span>
                <Dot size="16" />
            {/if}
            {waypoint.item.getLatitude().toFixed(6)}&deg; {waypoint.item
                .getLongitude()
                .toFixed(6)}&deg;
            {#if waypoint.item.ele !== undefined}
                <Dot size="16" />
                <WithUnits value={waypoint.item.ele} type="elevation" />
            {/if}
            {#if waypoint.item.time}
                <Dot size="16" />
                {i18n.df.format(waypoint.item.time)}
            {/if}
        </div>
        <!-- Delegated click handler on the ScrollArea: images come from {@html} so only event
             delegation can see them. -->
        <ScrollArea class="flex flex-col max-h-[30dvh]" onclick={handleDescriptionClick}>
            <!-- GPX descriptions may contain markup (links, line breaks, images), so they are
                 rendered as HTML after passing through sanitize() above, which allows only
                 a/br/img with href/target/src. The .contents wrapper is the scoping anchor for
                 the img/a styles below. -->
            <div class="contents description">
                {#if waypoint.item.desc}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    <span class="whitespace-pre-wrap">{@html sanitize(waypoint.item.desc)}</span>
                {/if}
                {#if waypoint.item.cmt && waypoint.item.cmt !== waypoint.item.desc}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    <span class="whitespace-pre-wrap">{@html sanitize(waypoint.item.cmt)}</span>
                {/if}
            </div>
        </ScrollArea>
        <div class="mt-2 flex flex-col gap-1">
            <CopyCoordinates coordinates={waypoint.item.attributes} />
            {#if $currentTool === Tool.WAYPOINT && selected}
                <Button
                    variant="outline"
                    onclick={() => {
                        if (waypoint.fileId) {
                            fileActions.deleteWaypoint(waypoint.fileId, waypoint.item._data.index);
                            waypoint.hide?.();
                        }
                    }}
                >
                    <Trash2 size="16" />
                    {i18n._('menu.delete')}
                    <Shortcut shift={true} click={true} />
                </Button>
            {/if}
        </div>
    </Card.Content>

    <!-- Full-screen viewer for description images: portal-based so it renders at document.body
         (the popup content is reparented into a MapLibre popup element where position:fixed is
         unreliable), with Esc / click-anywhere to close. -->
    <Dialog.Root
        open={lightboxSrc !== undefined}
        onOpenChange={(isOpen) => {
            if (!isOpen) {
                lightboxSrc = undefined;
            }
        }}
    >
        <Dialog.Trigger class="hidden" />
        <Dialog.Portal>
            <Dialog.Overlay class="bg-black/80 z-50" />
            <Dialog.Content
                class="fixed left-[50%] top-[50%] z-50 max-w-[95dvw] max-h-[95dvh] translate-x-[-50%] translate-y-[-50%] border-none bg-transparent p-0 shadow-none focus:outline-none"
                onclick={() => (lightboxSrc = undefined)}
            >
                {#if lightboxSrc}
                    <img
                        src={lightboxSrc}
                        alt=""
                        class="max-w-[95dvw] max-h-[95dvh] object-contain rounded-md"
                    />
                {/if}
                <Dialog.Title class="sr-only">
                    {waypoint.item.name ?? i18n._('gpx.waypoint')}
                </Dialog.Title>
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>
</Card.Root>

<style lang="postcss">
    @reference "../../../../app.css";

    .description :global(a) {
        @apply text-link;
        @apply hover:underline;
    }

    /* Scoped through the .contents wrapper around the description: `div :global(img)` alone
       would compile to `div.svelte-<hash> img`, matching nothing since the description sits
       inside child components (Card/ScrollArea) that don't carry this component's scoping
       class. */
    .description :global(img) {
        @apply my-0;
        @apply mx-auto;
        @apply rounded-md;
        /* Keep any image orientation fully visible inside the popup (no scrolling) and hint
           that clicking opens the full-size lightbox. */
        @apply max-w-full;
        @apply max-h-[25dvh];
        @apply cursor-zoom-in;
    }
</style>
