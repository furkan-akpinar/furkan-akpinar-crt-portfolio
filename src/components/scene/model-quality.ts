import { publicAssetUrl } from '../../lib/public-asset.ts';

export type ComputerTextureQuality = 'desktop' | 'mobile';

export const COMPUTER_MODEL_URLS: Record<ComputerTextureQuality, string> = {
  desktop: publicAssetUrl('/models/commodore64/web/commodore-64-4k.gltf'),
  mobile: publicAssetUrl('/models/commodore64/mobile/commodore-64-1k.gltf'),
};

/** Choose once before loading; a viewport resize must not decode a second model. */
export function selectComputerTextureQuality({ viewportWidth, coarsePointer, mobileUserAgent }: {
  viewportWidth: number;
  coarsePointer: boolean;
  mobileUserAgent: boolean;
}): ComputerTextureQuality {
  return viewportWidth < 900 || coarsePointer || mobileUserAgent ? 'mobile' : 'desktop';
}
