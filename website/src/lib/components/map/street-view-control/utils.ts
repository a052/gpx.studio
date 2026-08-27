import { safeWritable } from '$lib/logic/safe-store';

export const streetViewEnabled = safeWritable(false, 'streetViewEnabled');
