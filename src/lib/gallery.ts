import { Album, Asset, requestPermissionsAsync } from 'expo-media-library';
import { File, Paths } from 'expo-file-system';

const ALBUM = 'PDF Toolkit';

/** Save JPGs as normal photos in the phone's Gallery, inside a "PDF Toolkit" album. */
export async function saveImagesToGallery(images: { uri: string; name: string }[]): Promise<number> {
  const perm = await requestPermissionsAsync(true, ['photo']);
  if (!perm.granted) throw new Error('Allow photo access to save images to your Gallery · اسمح بالوصول للصور');

  // give the files friendly names (they become the photo names in the Gallery)
  const named = images.map((img) => {
    const dest = new File(Paths.cache, img.name);
    if (dest.exists) dest.delete();
    new File(img.uri).copySync(dest);
    return dest.uri;
  });

  let album = await Album.get(ALBUM);
  let saved = 0;
  for (const uri of named) {
    if (!album) {
      const first = await Asset.create(uri);
      album = await Album.create(ALBUM, [first], true);
    } else {
      await Asset.create(uri, album);
    }
    saved++;
  }
  return saved;
}
