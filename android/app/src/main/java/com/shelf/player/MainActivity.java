package com.shelf.player;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final String PREFS = "shelf_ui";
  private static final String KEY_NOTIF_ASKED = "notif_permission_asked";

  @Override public void onCreate(Bundle b) {
    registerPlugin(PlayerPlugin.class);
    registerPlugin(FilesPlugin.class);
    super.onCreate(b);
    getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    getBridge().getWebView().getSettings().setDomStorageEnabled(true);
    // chrome://inspect only for debuggable builds: a release APK must not expose the WebView (storage, DOM, JS) to a USB debugger
    if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
      WebView.setWebContentsDebuggingEnabled(true);
    }
    askNotificationPermissionOnce();
  }

  /** Android 13+: the media notification needs this permission. Asked once — not on every launch. */
  private void askNotificationPermissionOnce() {
    if (Build.VERSION.SDK_INT < 33) return;
    if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
    SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
    if (sp.getBoolean(KEY_NOTIF_ASKED, false)) return;
    sp.edit().putBoolean(KEY_NOTIF_ASKED, true).apply();
    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 100);
  }
}
