package expo.modules.docscanner

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
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

    /**
     * Which app opens this file type by default:
     *  "self"  → PDF Toolkit,  "none" → Android asks every time,  "other:<package>" → another app.
     */
    Function("defaultHandler") { mimeType: String ->
      val ctx = appContext.reactContext ?: return@Function "none"
      val probe = Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://pdftoolkit.probe/file"), mimeType)
      val info = ctx.packageManager.resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY)
      val pkg = info?.activityInfo?.packageName
      when {
        pkg == null -> "none"
        pkg == ctx.packageName -> "self"
        pkg == "android" || info?.activityInfo?.name?.contains("Resolver", ignoreCase = true) == true -> "none"
        else -> "other:$pkg"
      }
    }

    /** Label of an installed app ("Drive PDF Viewer"…), for the "set as default" card. */
    Function("appLabel") { pkg: String ->
      val pm = appContext.reactContext?.packageManager ?: return@Function pkg
      try {
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
      } catch (e: Exception) {
        pkg
      }
    }

    /**
     * Opens a sample file with Android's "Open with" sheet, where the user can tap PDF Toolkit → "Always".
     * contentUri must come from FileSystem.getContentUriAsync (readable by the system sheet).
     */
    Function("openWithChooser") { contentUri: String, mimeType: String ->
      val activity = appContext.currentActivity ?: return@Function false
      val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(Uri.parse(contentUri), mimeType)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      try {
        activity.startActivity(intent)
        true
      } catch (e: ActivityNotFoundException) {
        false
      }
    }

    /** App info page of another app, where "Open by default → Clear defaults" lives. */
    Function("openAppInfo") { pkg: String ->
      val activity = appContext.currentActivity ?: return@Function false
      try {
        activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")))
        true
      } catch (e: Exception) {
        false
      }
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
