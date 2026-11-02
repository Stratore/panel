export const APP_NAME = 'Panel';

export const CATEGORIES = ['ai', 'cyber', 'innovation', 'dev', 'hardware'] as const;
export type Category = (typeof CATEGORIES)[number];
