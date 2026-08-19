<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import Help from '$lib/components/Help.svelte';
    import { LoaderCircle, MountainSnow } from '@lucide/svelte';
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
</script>

<div class="flex flex-col gap-3 w-full max-w-80 {props.class ?? ''}">
    <Button
        variant="outline"
        class="whitespace-normal h-fit min-h-8 py-1"
        disabled={!validSelection || loading}
        onclick={requestElevation}
    >
        {#if loading}
            <LoaderCircle size="16" class="shrink-0 animate-spin" />
        {:else}
            <MountainSnow size="16" class="shrink-0" />
        {/if}
        {i18n._('toolbar.elevation.button')}
    </Button>
    <Help link={getURLForLanguage(i18n.lang, '/help/toolbar/elevation')}>
        {#if validSelection}
            {i18n._('toolbar.elevation.help')}
        {:else}
            {i18n._('toolbar.elevation.help_no_selection')}
        {/if}
    </Help>
</div>
