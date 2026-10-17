import { IMAGE_EXTS } from '@shared/formats';

export const isImageExtForTest = (ext: string) => (IMAGE_EXTS as readonly string[]).includes(ext.toLowerCase());
