<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import Help from '$lib/components/Help.svelte';
    import { Eraser, LoaderCircle, MountainSnow } from '@lucide/svelte';
    import { toast } from 'svelte-sonner';
    import { i18n } from '$lib/i18n.svelte';
    import { getURLForLanguage } from '$lib/utils';
    import { selection } from '$lib/logic/selection';
    import { fileActions } from '$lib/logic/file-actions';

    let props: {
        class?: string;
    } = $props();

    let validSelection = $derived($selection.size > 0);
    let loading = $state(false);
    let clearing = $state(false);

    async function requestElevation() {
        loading = true;
        const promise = fileActions.addElevationToSelection();
        toast.promise(promise, {
            loading: i18n._('toolbar.elevation.loading'),
            success: (changed) =>
                changed
                    ? i18n._('toolbar.elevation.updated')
                    : i18n._('toolbar.elevation.no_change'),
            error: i18n._('toolbar.elevation.error'),
        });
        try {
            await promise;
        } finally {
            loading = false;
        }
    }

    // No confirmation dialog, matching every other destructive action in the app: undo is the safety
    // net. The button stays enabled for any non-empty selection because there is no cheap presence
    // test for elevation data — the statistics only expose smoothed, thresholded gain and loss, and
    // they do not cover waypoints at all — so the "nothing to clear" case is reported from the return
    // value instead, the same way the request above reports `no_change`.
    async function clearElevation() {
        clearing = true;
        try {
            if (await fileActions.clearElevationDataFromSelection()) {
                toast.success(i18n._('toolbar.elevation.cleared'));
            } else {
                toast.success(i18n._('toolbar.elevation.nothing_to_clear'));
            }
        } catch (e) {
            console.error('Clearing the elevation data failed:', e);
            toast.error(i18n._('toolbar.elevation.clear_error'));
        } finally {
            clearing = false;
        }
    }
</script>

<div class="flex flex-col gap-3 w-full max-w-80 {props.class ?? ''}">
    <div class="flex flex-col gap-2">
        <Button
            variant="outline"
            class="whitespace-normal h-fit min-h-8 py-1"
            disabled={!validSelection || loading || clearing}
            onclick={requestElevation}
        >
            {#if loading}
                <LoaderCircle size="16" class="shrink-0 animate-spin" />
            {:else}
                <MountainSnow size="16" class="shrink-0" />
            {/if}
            {i18n._('toolbar.elevation.button')}
        </Button>
        <!-- Also disabled while a request is in flight: `addElevationToSelection` only reaches the
        file action manager after awaiting the elevation tiles, so a clear started in the meantime
        would be committed first and then silently overwritten by the arriving elevations. -->
        <Button
            variant="outline"
            class="whitespace-normal h-fit min-h-8 py-1"
            disabled={!validSelection || loading || clearing}
            onclick={clearElevation}
        >
            <Eraser size="16" class="shrink-0" />
            {i18n._('toolbar.elevation.clear')}
        </Button>
    </div>
    <Help link={getURLForLanguage(i18n.lang, '/help/toolbar/elevation')}>
        {#if validSelection}
            {i18n._('toolbar.elevation.help')}
        {:else}
            {i18n._('toolbar.elevation.help_no_selection')}
        {/if}
    </Help>
</div>
