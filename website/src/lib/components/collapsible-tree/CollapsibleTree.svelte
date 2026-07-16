<script lang="ts">
    import { setContext, untrack, type Snippet } from 'svelte';
    import { CollapsibleTreeState } from './utils.svelte';

    const {
        defaultState = 'open',
        side = 'right',
        nohover = false,
        slotInsideTrigger = true,
        children,
    }: {
        defaultState?: 'open' | 'closed';
        side?: 'left' | 'right';
        nohover?: boolean;
        slotInsideTrigger?: boolean;
        children: Snippet;
    } = $props();

    // The props below are intentionally captured once at init: they seed the
    // tree state and context, which cannot be updated after creation anyway.
    let open = $state(untrack(() => new CollapsibleTreeState(defaultState)));

    setContext('collapsible-tree-state', open);
    setContext(
        'collapsible-tree-side',
        untrack(() => side)
    );
    setContext(
        'collapsible-tree-nohover',
        untrack(() => nohover)
    );
    setContext('collapsible-tree-parent-id', 'root');
    setContext(
        'collapsible-tree-slot-inside-trigger',
        untrack(() => slotInsideTrigger)
    );
</script>

{@render children()}
