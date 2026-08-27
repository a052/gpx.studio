import { writable, type Readable, type StartStopNotifier, type Writable } from 'svelte/store';

// `svelte/store` shares a single module-global `subscriber_queue` between every store in the
// application. When a subscriber callback throws while that queue is being flushed, the flush loop
// aborts before clearing the queue, so from then on every `set()` only appends to it and no
// subscriber is ever called again: the app keeps running but stops updating entirely, until a
// reload. Guarding the callback keeps the flush loop intact — the failing subscriber is skipped and
// reported, every other subscriber still receives the value.
//
// Use these instead of `svelte/store`'s `writable`/`derived` for application-level state. Guarding
// at creation time covers every consumer of the store at once: explicit `.subscribe()` calls,
// `$store` reads in components, and `derived` stores built on top of it.

function guard<T>(run: (value: T) => void, label: string): (value: T) => void {
    return (value: T) => {
        try {
            run(value);
        } catch (error) {
            console.error(`[safe-store] a subscriber of "${label}" failed:`, error);
        }
    };
}

// Wrap an existing store so that a throwing subscriber cannot break the shared notification queue.
// Use it for stores that are not created with `safeWritable`, e.g. `derived(...)`.
export function guardSubscribers<T>(store: Writable<T>, label: string): Writable<T>;
export function guardSubscribers<T>(store: Readable<T>, label: string): Readable<T>;
export function guardSubscribers<T>(
    store: Readable<T> | Writable<T>,
    label: string
): Readable<T> | Writable<T> {
    const guarded: Readable<T> = {
        subscribe: (run, invalidate) => store.subscribe(guard(run, label), invalidate),
    };
    if ('set' in store) {
        return {
            ...guarded,
            set: store.set,
            update: store.update,
        };
    }
    return guarded;
}

// Drop-in replacement for `svelte/store`'s `writable`, with guarded subscribers. `label` only shows
// up in the console when a subscriber throws, so make it identify the store.
export function safeWritable<T>(
    value: T,
    label: string,
    start?: StartStopNotifier<T>
): Writable<T> {
    return guardSubscribers(writable(value, start), label);
}
