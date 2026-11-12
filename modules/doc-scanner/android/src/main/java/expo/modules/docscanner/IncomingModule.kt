package expo.modules.docscanner

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reports files/links the app was opened with:
 *  - "Open with" (ACTION_VIEW) for PDF / Word files from WhatsApp, Gmail, Files…
 *  - "Share" (ACTION_SEND) of a single PDF / Word file
 *  - app links such as pdftoolkit://scan (used by the home-screen widget)
 * JS: Incoming.getInitial() for a cold start, and the "onIncoming" event while running.
 */
class IncomingModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Incoming")

    Events("onIncoming")

    Function("getInitial") {
      describe(appContext.currentActivity?.intent)
    }

    OnNewIntent { intent ->
      val info = describe(intent)
      if (info != null) sendEvent("onIncoming", info)
    }
  }

  private fun describe(intent: Intent?): Map<String, Any?>? {
    if (intent == null) return null
    if (intent.getBooleanExtra(HANDLED, false)) return null // don't deliver the same intent twice

    val uri: Uri? = when (intent.action) {
      Intent.ACTION_VIEW -> intent.data
      Intent.ACTION_SEND -> {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      }
      else -> null
    }
    if (uri == null) return null
    intent.putExtra(HANDLED, true)

    val isFile = uri.scheme == "content" || uri.scheme == "file"
    return mapOf(
      "uri" to uri.toString(),
      "mimeType" to (intent.type ?: if (isFile) mimeOf(uri) else null),
      "name" to (if (isFile) displayName(uri) else null)
    )
  }

  private fun mimeOf(uri: Uri): String? = try {
    appContext.reactContext?.contentResolver?.getType(uri)
  } catch (e: Exception) {
    null
  }

  private fun displayName(uri: Uri): String? {
    if (uri.scheme == "file") return uri.lastPathSegment
    return try {
      appContext.reactContext?.contentResolver
        ?.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    } catch (e: Exception) {
      null
    }
  }

  companion object {
    private const val HANDLED = "pdftoolkit_handled"
  }
}
