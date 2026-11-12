/**
 * Password-protect / unlock PDFs. Uses @cantoo/pdf-lib (a maintained pdf-lib fork with encryption);
 * the rest of the app stays on pdf-lib.
 */
import { PDFDocument } from '@cantoo/pdf-lib';

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password · كلمة السر غلط');
  }
}

/** Is this PDF encrypted (needs a password or has restrictions)? */
export async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.isEncrypted;
  } catch {
    return false;
  }
}

/** Add an "open" password (AES-256). */
export async function protectPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  if (password.length < 4) throw new Error('Use a password with at least 4 characters');
  if (await isEncrypted(bytes)) throw new Error('This PDF is already protected. Unlock it first.');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.encrypt({
    userPassword: password,
    ownerPassword: password,
    algorithm: 'AES-256',
    // whoever knows the password can do everything
    permissions: { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true },
  });
  return doc.save({ useObjectStreams: false });
}

/** Remove the password. You must know it — this does not crack PDFs. */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  if (!(await isEncrypted(bytes))) throw new Error('This PDF is not password-protected.');
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  } catch (e: any) {
    if (/password|decrypt|encrypt/i.test(String(e?.message))) throw new WrongPasswordError();
    throw e;
  }
  // copy the pages into a fresh, unencrypted document
  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, doc.getPageIndices());
  pages.forEach((p) => out.addPage(p));
  return out.save();
}
