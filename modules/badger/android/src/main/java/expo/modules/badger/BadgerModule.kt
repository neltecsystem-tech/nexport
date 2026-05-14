package expo.modules.badger

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import me.leolin.shortcutbadger.ShortcutBadger

class BadgerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Badger")

    Function("setBadgeCount") { count: Int ->
      val ctx = appContext.reactContext ?: return@Function false
      val safe = if (count < 0) 0 else count
      ShortcutBadger.applyCount(ctx, safe)
    }

    Function("removeBadge") {
      val ctx = appContext.reactContext ?: return@Function false
      ShortcutBadger.removeCount(ctx)
    }
  }
}
