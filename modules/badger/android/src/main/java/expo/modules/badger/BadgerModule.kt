package expo.modules.badger

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import me.leolin.shortcutbadger.ShortcutBadger

private const val TAG = "Badger"

class BadgerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Badger")

    Function("setBadgeCount") { count: Int ->
      val ctx = appContext.reactContext ?: return@Function false
      val safe = if (count < 0) 0 else count
      Log.i(TAG, "setBadgeCount(count=$safe) manufacturer=${android.os.Build.MANUFACTURER} model=${android.os.Build.MODEL} sdk=${android.os.Build.VERSION.SDK_INT}")
      val results = mutableListOf<String>()
      results += "shortcutBadger=${tryShortcutBadger(ctx, safe)}"
      results += "sonyProvider=${trySonyProvider(ctx, safe)}"
      results += "sonyIntent=${trySonyIntent(ctx, safe)}"
      Log.i(TAG, "setBadgeCount result: ${results.joinToString(" | ")}")
      true
    }

    Function("removeBadge") {
      val ctx = appContext.reactContext ?: return@Function false
      Log.i(TAG, "removeBadge")
      tryShortcutBadger(ctx, 0)
      trySonyProvider(ctx, 0)
      trySonyIntent(ctx, 0)
      true
    }
  }

  private fun tryShortcutBadger(ctx: Context, count: Int): String {
    return try {
      val ok = ShortcutBadger.applyCount(ctx, count)
      "ok=$ok"
    } catch (e: Throwable) {
      "ERR(${e.javaClass.simpleName}:${e.message})"
    }
  }

  private fun trySonyProvider(ctx: Context, count: Int): String {
    return try {
      val pkg = ctx.packageName
      val launchIntent = ctx.packageManager.getLaunchIntentForPackage(pkg)
        ?: return "noLaunchIntent"
      val activityName = launchIntent.component?.className ?: return "noActivityName"
      val uri = Uri.parse("content://com.sonymobile.home.resourceprovider/badge")
      val values = ContentValues().apply {
        put("badge_count", count)
        put("package_name", pkg)
        put("activity_name", activityName)
      }
      val result = ctx.contentResolver.insert(uri, values)
      "ok(uri=$result, act=$activityName)"
    } catch (e: Throwable) {
      "ERR(${e.javaClass.simpleName}:${e.message})"
    }
  }

  private fun trySonyIntent(ctx: Context, count: Int): String {
    return try {
      val pkg = ctx.packageName
      val launchIntent = ctx.packageManager.getLaunchIntentForPackage(pkg)
        ?: return "noLaunchIntent"
      val activityName = launchIntent.component?.className ?: return "noActivityName"
      val intent = Intent("com.sonyericsson.home.action.UPDATE_BADGE").apply {
        putExtra("com.sonyericsson.home.intent.extra.badge.ACTIVITY_NAME", activityName)
        putExtra("com.sonyericsson.home.intent.extra.badge.SHOW_MESSAGE", count > 0)
        putExtra("com.sonyericsson.home.intent.extra.badge.MESSAGE", count.toString())
        putExtra("com.sonyericsson.home.intent.extra.badge.PACKAGE_NAME", pkg)
      }
      ctx.sendBroadcast(intent)
      "ok"
    } catch (e: Throwable) {
      "ERR(${e.javaClass.simpleName}:${e.message})"
    }
  }
}
