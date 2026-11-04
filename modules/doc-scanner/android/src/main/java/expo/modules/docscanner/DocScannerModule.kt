package expo.modules.docscanner

import android.app.Activity
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Opens Google's ML Kit document scanner: auto edge detection, 4-corner crop,
 * perspective correction, filters, multi-page, and import from gallery.
 * Resolves with a list of JPEG file URIs ([] if the user cancels).
 */
class DocScannerModule : Module() {
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("DocScanner")

    AsyncFunction("scan") { pageLimit: Int, allowGallery: Boolean, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("E_NO_ACTIVITY", "The app is not in the foreground", null)
        return@AsyncFunction
      }
      if (pending != null) {
        promise.reject("E_BUSY", "The scanner is already open", null)
        return@AsyncFunction
      }

      val builder = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(allowGallery)
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
      if (pageLimit > 0) builder.setPageLimit(pageLimit)

      pending = promise
      GmsDocumentScanning.getClient(builder.build())
        .getStartScanIntent(activity)
        .addOnSuccessListener { sender ->
          try {
            activity.startIntentSenderForResult(sender, REQUEST_CODE, null, 0, 0, 0)
          } catch (e: Exception) {
            pending?.reject("E_START", e.message ?: "Could not open the scanner", e)
            pending = null
          }
        }
        .addOnFailureListener { e ->
          // Usually: Google Play services missing/outdated, or the scanner module is still downloading
          pending?.reject("E_UNAVAILABLE", e.message ?: "Scanner not available on this device", e)
          pending = null
        }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CODE) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      if (payload.resultCode != Activity.RESULT_OK) {
        promise.resolve(emptyList<String>())
        return@OnActivityResult
      }
      val result = GmsDocumentScanningResult.fromActivityResultIntent(payload.data)
      promise.resolve(result?.pages?.map { it.imageUri.toString() } ?: emptyList<String>())
    }
  }

  companion object {
    private const val REQUEST_CODE = 47021
  }
}
