/**
 * Image conversion profiles (v1.0-final-candidate §13).
 * Small, stable, cross-engine-mappable profiles. No raw engine parameter leakage.
 * 'standard' is accepted as an alias for 'balanced' by the Sharp engine.
 */
export type ImageProfile = 'balanced' | 'high_quality' | 'lossless';

export const IMAGE_PROFILES: ImageProfile[] = ['balanced', 'high_quality', 'lossless'];

export interface JpegProfileOpts {
  quality: number;
  chromaSubsampling: '4:2:0' | '4:4:4';
  mozjpeg: boolean;
}
export interface PngProfileOpts { compressionLevel: number; }
export interface WebpProfileOpts { quality?: number; lossless?: boolean; alphaQuality: number; }
export interface AvifProfileOpts { quality?: number; lossless?: boolean; }

export interface ImageProfileOpts {
  jpeg: JpegProfileOpts;
  png: PngProfileOpts;
  webp: WebpProfileOpts;
  avif: AvifProfileOpts;
}

export const PROFILE_SETTINGS: Record<ImageProfile, ImageProfileOpts> = {
  balanced: {
    jpeg: { quality: 80, chromaSubsampling: '4:2:0', mozjpeg: true },
    png: { compressionLevel: 6 },
    webp: { quality: 80, alphaQuality: 100 },
    avif: { quality: 50 },
  },
  high_quality: {
    jpeg: { quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true },
    png: { compressionLevel: 9 },
    webp: { quality: 90, alphaQuality: 100 },
    avif: { quality: 63 },
  },
  lossless: {
    // JPEG has no lossless mode; engine rejects lossless+jpeg before using this.
    jpeg: { quality: 100, chromaSubsampling: '4:4:4', mozjpeg: true },
    png: { compressionLevel: 9 },
    webp: { lossless: true, alphaQuality: 100 },
    avif: { lossless: true },
  },
};

export function resolveImageProfile(raw: string): ImageProfile {
  if (raw === 'standard') return 'balanced';
  if ((IMAGE_PROFILES as string[]).includes(raw)) return raw as ImageProfile;
  return 'balanced';
}

export function isValidImageProfile(raw: string): boolean {
  return raw === 'standard' || (IMAGE_PROFILES as string[]).includes(raw);
}
