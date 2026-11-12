import {
  type Asset,
  addAssetsToAlbumAsync,
  createAlbumAsync,
  createAssetAsync,
  getAlbumAsync,
  requestPermissionsAsync,
} from 'expo-media-library/legacy';
import { File, Paths } from 'expo-file-system';

const ALBUM = 'PDF Toolkit';

/**
 * Save JPGs as normal photos in the phone's Gallery, grouped in a "PDF Toolkit" album.
 *
 * Uses the stable (legacy) MediaLibrary API: the newer Asset.create() wrote into MediaStore's
 * *Files* collection on some Android versions, which rejects DCIM ("Primary directory DCIM not allowed").
 * Photos are always saved first; putting them in the album is best-effort.
 */
export async function saveImagesToGallery(images: { uri: string; name: string }[]): Promise<number> {
  const perm = await requestPermissionsAsync(true, ['photo']);
  if (!perm.granted) throw new Error('Allow photo access to save images to your Gallery · اسمح بالوصول للصور');

  const assets: Asset[] = [];
  for (const img of images) {
    // copy with a friendly .jpg name (it becomes the photo's name in the Gallery)
    const dest = new File(Paths.cache, img.name.endsWith('.jpg') ? img.name : `${img.name}.jpg`);
    if (dest.exists) dest.delete();
    new File(img.uri).copySync(dest);
    assets.push(await createAssetAsync(dest.uri));
  }

  try {
    const album = await getAlbumAsync(ALBUM);
    if (album) await addAssetsToAlbumAsync(assets, album, false);
    else await createAlbumAsync(ALBUM, assets[0], false).then((a) => (assets.length > 1 ? addAssetsToAlbumAsync(assets.slice(1), a, false) : true));
  } catch (e) {
    console.warn('Saved to Gallery, but could not group into album', e); // photos are still in the Gallery
  }
  return assets.length;
}
