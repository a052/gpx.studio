import { type Writable } from 'svelte/store';
import { safeWritable } from '$lib/logic/safe-store';

export enum SplitType {
    FILES = 'files',
    TRACKS = 'tracks',
    SEGMENTS = 'segments',
}

export const splitAs: Writable<SplitType> = safeWritable(SplitType.FILES, 'splitAs');
