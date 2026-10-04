package com.shelf.player;

import android.Manifest;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override public void onCreate(Bundle b) {
    registerPlugin(PlayerPlugin.class);
    registerPlugin(FilesPlugin.class);
    super.onCreate(b);
    getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    getBridge().getWebView().getSettings().setDomStorageEnabled(true);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
      WebView.setWebContentsDebuggingEnabled(true);
    }
    if (Build.VERSION.SDK_INT >= 33) {
      requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 100);
    }
  }
}
