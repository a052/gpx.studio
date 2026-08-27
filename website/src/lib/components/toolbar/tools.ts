import { type Writable } from 'svelte/store';
import { safeWritable } from '$lib/logic/safe-store';

export enum Tool {
    ROUTING,
    WAYPOINT,
    SCISSORS,
    TIME,
    MERGE,
    EXTRACT,
    ELEVATION,
    REDUCE,
    CLEAN,
}

export const currentTool: Writable<Tool | null> = safeWritable(null, 'currentTool');
