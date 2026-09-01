<script lang="ts">
    import { page } from '$app/state';
    import { onMount } from 'svelte';
    import Embedding from '$lib/components/embedding/Embedding.svelte';
    import {
        getMergedEmbeddingOptions,
        type EmbeddingOptions,
    } from '$lib/components/embedding/embedding';

    let embeddingOptions: EmbeddingOptions | undefined = undefined;

    onMount(() => {
        const raw = page.url.searchParams.get('options');
        if (raw === null) {
            return;
        }
        const options = JSON.parse(raw);
        if (options === null) {
            return;
        }
        embeddingOptions = getMergedEmbeddingOptions(options);
    });
</script>

{#if embeddingOptions}
    <Embedding options={embeddingOptions} hash={page.url.hash} />
{/if}
