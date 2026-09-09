<script lang="ts">
    import Help from '$lib/components/Help.svelte';
    import WithUnits from '$lib/components/WithUnits.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Separator } from '$lib/components/ui/separator';
    import { map } from '$lib/components/map/map';
    import { i18n } from '$lib/i18n.svelte';
    import { onDestroy, onMount } from 'svelte';
    import { Ruler, Trash2 } from '@lucide/svelte';
    import { getURLForLanguage } from '$lib/utils';
    import { MeasureControls } from './measure-controls';
    import { measurePoints, measureTotalKm } from './measure';

    let props: {
        class?: string;
    } = $props();

    let controls: MeasureControls | undefined = undefined;

    onMount(() => {
        if ($map && map.layerEventManager) {
            controls = new MeasureControls($map, map.layerEventManager);
        }
    });

    onDestroy(() => {
        controls?.destroy();
    });

    function clear() {
        $measurePoints = [];
        $measureTotalKm = 0;
    }
</script>

<div class="flex flex-col gap-3 w-full max-w-80 {props.class ?? ''}">
    <div class="flex flex-row justify-between items-center gap-3">
        <span class="flex flex-row items-center shrink-0">
            <Ruler size="16" class="mr-1" />
            {i18n._('toolbar.ruler.total')}
        </span>
        <WithUnits value={$measureTotalKm} type="distance" />
    </div>
    <div class="flex flex-row justify-between items-center gap-3">
        <span class="shrink-0">
            {i18n._('toolbar.ruler.points')}
        </span>
        <span>{$measurePoints.length}</span>
    </div>
    <Separator />
    <Button variant="outline" disabled={$measurePoints.length === 0} onclick={clear}>
        <Trash2 size="16" />
        {i18n._('toolbar.ruler.clear')}
    </Button>
    <Help link={getURLForLanguage(i18n.lang, '/help/toolbar/ruler')}>
        {i18n._('toolbar.ruler.help')}
    </Help>
</div>

<svelte:window
    on:keydown={(e) => {
        if (e.key === 'Backspace' && $measurePoints.length > 0) {
            e.preventDefault();
            $measurePoints = $measurePoints.slice(0, -1);
        }
    }}
/>

<style lang="postcss">
    @reference "../../../../../app.css";

    /* The live segment label is a maplibre popup whose text is unreadable over the map because the
       app globally renders popup content transparent and unpadded. Give this popup (tagged with the
       `measure-popup` class in MeasureControls) a padded, filled background instead. `width:
       fit-content` + `white-space: nowrap` make the box hug the text, so it grows and shrinks with
       the value. The popup is mounted outside this component's DOM, so the selector must be a bare
       `:global(...)`. */
    /* The `measure-popup` and `maplibregl-popup` classes sit on the same root element; chaining them
       gives this rule higher specificity than Map.svelte's `div :global(.maplibregl-popup-content)`,
       which otherwise forces the content transparent and unpadded and wins the cascade. */
    :global(.measure-popup.maplibregl-popup .maplibregl-popup-content) {
        @apply bg-background text-foreground;
        @apply px-1.5 py-0.5;
        @apply rounded-md shadow-md;
        width: fit-content;
        font-size: 0.75rem;
        line-height: 1rem;
        white-space: nowrap;
    }
</style>
