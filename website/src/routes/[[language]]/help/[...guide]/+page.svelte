<script lang="ts">
    import { page } from '$app/state';
    import { getNextGuide, getPreviousGuide } from '$lib/components/docs/docs';
    import DocsContainer from '$lib/components/docs/DocsContainer.svelte';
    import { Button } from '$lib/components/ui/button';
    import { getURLForLanguage } from '$lib/utils';
    import { ChevronLeft, ChevronRight } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import type { Component } from 'svelte';

    let {
        data,
    }: { data: { guideModule: { default: Component }; guideTitles: Record<string, string> } } =
        $props();

    let previousGuide = $derived(getPreviousGuide(page.params.guide ?? ''));
    let nextGuide = $derived(getNextGuide(page.params.guide ?? ''));
</script>

<div class="markdown flex flex-col gap-3">
    <DocsContainer module={data.guideModule.default} />
</div>

<div class="flex flex-row flex-wrap gap-3 pt-6">
    {#if previousGuide}
        <Button
            variant="outline"
            class="mr-auto"
            href={getURLForLanguage(i18n.lang, `/help/${previousGuide}`)}
        >
            <ChevronLeft size="14" class="mt-0.5" />
            {data.guideTitles[previousGuide]}
        </Button>
    {/if}
    {#if nextGuide}
        <Button
            variant="outline"
            class="ml-auto"
            href={getURLForLanguage(i18n.lang, `/help/${nextGuide}`)}
        >
            {data.guideTitles[nextGuide]}
            <ChevronRight size="14" class="mt-0.5" />
        </Button>
    {/if}
</div>
