package expo.modules.docscanner

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/** Home-screen widget: one tap opens the app straight into the document scanner. */
class ScanWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("pdftoolkit://scan"))
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val pending = PendingIntent.getActivity(
        context,
        0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val views = RemoteViews(context.packageName, R.layout.pdftk_widget_scan)
      views.setOnClickPendingIntent(R.id.pdftk_widget_root, pending)
      manager.updateAppWidget(id, views)
    }
  }
}
