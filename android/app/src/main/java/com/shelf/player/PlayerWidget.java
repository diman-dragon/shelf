package com.shelf.player;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

public class PlayerWidget extends AppWidgetProvider {
  static String title="Полка", artist="Откройте книгу";
  static boolean playing;

  static PendingIntent pi(Context c,String a){
    return PendingIntent.getBroadcast(c,a.hashCode(),new Intent(c,PlayerWidget.class).setAction(a),
      PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  }
  static void push(Context c){
    RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.widget);
    v.setTextViewText(R.id.wTitle,title);v.setTextViewText(R.id.wArtist,artist);
    v.setImageViewResource(R.id.wPlay,playing?android.R.drawable.ic_media_pause:android.R.drawable.ic_media_play);
    v.setOnClickPendingIntent(R.id.wPrev,pi(c,"prev"));v.setOnClickPendingIntent(R.id.wBack,pi(c,"back10"));
    v.setOnClickPendingIntent(R.id.wPlay,pi(c,"toggle"));v.setOnClickPendingIntent(R.id.wNext,pi(c,"next"));
    Intent open=c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
    if(open!=null)v.setOnClickPendingIntent(R.id.wTitle,PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT));
    AppWidgetManager.getInstance(c).updateAppWidget(new ComponentName(c,PlayerWidget.class),v);
  }
  @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids){push(c);}
  @Override public void onReceive(Context c,Intent i){
    super.onReceive(c,i);
    String a=i.getAction();
    // The player now lives in PlayerService, so the widget controls it directly (no WebView needed)
    if("prev".equals(a)||"next".equals(a)||"toggle".equals(a)||"back10".equals(a)||"forward".equals(a))PlayerService.handleAction(a);
  }
}
