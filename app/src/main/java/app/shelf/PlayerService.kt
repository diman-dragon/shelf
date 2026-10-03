package app.shelf

import android.app.PendingIntent
import android.content.Intent
import android.media.audiofx.LoudnessEnhancer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Фоновый плеер: ExoPlayer + MediaSession (шторка, экран блокировки, гарнитура). */
class PlayerService : MediaSessionService() {
    private var session: MediaSession? = null
    private var boost: LoudnessEnhancer? = null
    private lateinit var player: ExoPlayer
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val h = Handler(Looper.getMainLooper())
    private val tick = object : Runnable { override fun run() { save(); h.postDelayed(this, 15_000) } }
    private val back10 = SessionCommand("back10", Bundle.EMPTY)
    private val boostCmd = SessionCommand("boost", Bundle.EMPTY)

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(AudioAttributes.Builder().setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).setUsage(C.USAGE_MEDIA).build(), true)
            .setHandleAudioBecomingNoisy(true).setWakeMode(C.WAKE_MODE_LOCAL)
            .setSeekBackIncrementMs(15_000).setSeekForwardIncrementMs(15_000).build()
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { h.removeCallbacks(tick); if (isPlaying) h.postDelayed(tick, 15_000) else save() }
            override fun onMediaItemTransition(m: MediaItem?, reason: Int) { save() }
            override fun onAudioSessionIdChanged(id: Int) { boost?.release(); boost = runCatching { LoudnessEnhancer(id) }.getOrNull() }
        })
        val btn = CommandButton.Builder().setDisplayName("−10 с").setIconResId(R.drawable.ic_back10).setSessionCommand(back10).build()
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        session = MediaSession.Builder(this, player).setSessionActivity(open).setCustomLayout(ImmutableList.of(btn))
            .setCallback(object : MediaSession.Callback {
                override fun onConnect(s: MediaSession, c: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
                    MediaSession.ConnectionResult.AcceptedResultBuilder(s).setAvailableSessionCommands(
                        MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(back10).add(boostCmd).build()).build()

                override fun onCustomCommand(s: MediaSession, c: MediaSession.ControllerInfo, cmd: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
                    when (cmd.customAction) {
                        "back10" -> player.seekTo(maxOf(0L, player.currentPosition - 10_000))
                        "boost" -> { val mb = args.getInt("mb"); boost?.setTargetGain(mb); boost?.enabled = mb > 0 }
                    }
                    return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }

                override fun onAddMediaItems(s: MediaSession, c: MediaSession.ControllerInfo, items: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> =
                    Futures.immediateFuture(items.map { it.buildUpon().setUri(it.mediaId).build() }.toMutableList())
            }).build()
    }

    private fun save() {
        val id = player.currentMediaItem?.mediaMetadata?.extras?.getLong("book") ?: return
        val i = player.currentMediaItemIndex; val p = player.currentPosition
        scope.launch { Db.get(this@PlayerService).dao().savePos(id, i, p, System.currentTimeMillis()) }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = session
    override fun onTaskRemoved(rootIntent: Intent?) { if (!player.playWhenReady) stopSelf() }
    override fun onDestroy() {
        save(); h.removeCallbacks(tick); boost?.release(); session?.release(); player.release(); scope.cancel(); super.onDestroy()
    }
}
