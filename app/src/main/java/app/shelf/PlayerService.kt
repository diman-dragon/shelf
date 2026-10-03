package app.shelf

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.SilenceSkippingAudioProcessor
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import app.shelf.dsp.DspProcessor
import app.shelf.dsp.DspState
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Общий доступ к DSP-состоянию между сервисом и UI экрана «Звук». */
object Dsp { val state = DspState(); var processor: DspProcessor? = null }

/**
 * Фоновый плеер (FR-30…FR-32): ExoPlayer + MediaSessionService, шторка, экран блокировки, гарнитура.
 * Цепочка эффектов — DspProcessor (ТЗ 5.1). Кнопки: ⏮ ⏪(шаг назад, умолчание 10 с) ⏯ ⏭ (FR-31).
 */
class PlayerService : MediaSessionService() {
    private var session: MediaSession? = null
    private lateinit var player: ExoPlayer
    private lateinit var dspProc: DspProcessor
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val h = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("shelf", 0) }

    private val backCmd = SessionCommand("back_step", Bundle.EMPTY)
    private val boostCmd = SessionCommand("boost", Bundle.EMPTY)

    private val tick = object : Runnable {
        override fun run() { save(); val eco = prefs.getBoolean("eco", false); h.postDelayed(this, if (eco) 30_000 else 15_000) } // FR-10
    }

    override fun onCreate() {
        super.onCreate()
        app.shelf.dsp.Profiles.ctx = applicationContext
        dspProc = DspProcessor(Dsp.state); Dsp.processor = dspProc
        val silenceSkip = SilenceSkippingAudioProcessor(400_000, 400_000, 256) // FR-13 (пороги в мкс)
        val factory = object : DefaultRenderersFactory(this) {
            override fun buildAudioProcessors(): java.util.Collection<androidx.media3.exoplayer.audio.AudioProcessor> {
                val list = mutableListOf<androidx.media3.exoplayer.audio.AudioProcessor>()
                if (prefs.getBoolean("silence_skip", false)) list += silenceSkip
                if (Dsp.state.anyEffect || dspProc.spectrumEnabled) list += dspProc // при эффектах offload отключается автоматически (5.4)
                return list
            }
        }
        val stepBack = (prefs.getInt("step_back", 15) * 1000L)
        player = ExoPlayer.Builder(this, factory)
            .setAudioAttributes(AudioAttributes.Builder().setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).setUsage(C.USAGE_MEDIA).build(), true) // FR-18
            .setHandleAudioBecomingNoisy(true) // FR-17: автопауза при вытаскивании наушников
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .setSeekBackIncrementMs(stepBack).setSeekForwardIncrementMs(prefs.getInt("step_fwd", 15) * 1000L)
            .build()
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                h.removeCallbacks(tick); h.removeCallbacks(fadeTick)
                if (isPlaying) { val eco = prefs.getBoolean("eco", false); h.postDelayed(tick, if (eco) 30_000 else 15_000); startFadeLoop() }
                else { save(); markPausedNow() } // FR-10: при паузе
            }
            override fun onMediaItemTransition(m: MediaItem?, reason: Int) { save() } // FR-10: при смене главы
            override fun onPlaybackStateChanged(s: Int) { if (s == Player.STATE_ENDED) markDone() } // FR-19
        })
        applySmartRewind() // FR-11
        startFadeLoop()
        val btnBack = CommandButton.Builder().setDisplayName("−${prefs.getInt("notif_back", 10)} с")
            .setIconResId(R.drawable.ic_back10).setSessionCommand(backCmd).build()
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        session = MediaSession.Builder(this, player).setSessionActivity(open)
            .setCustomLayout(ImmutableList.of(btnBack))
            .setCallback(object : MediaSession.Callback {
                override fun onConnect(s: MediaSession, c: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
                    MediaSession.ConnectionResult.AcceptedResultBuilder(s).setAvailableSessionCommands(
                        MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(backCmd).add(boostCmd).build()).build()

                override fun onCustomCommand(s: MediaSession, c: MediaSession.ControllerInfo, cmd: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
                    when (cmd.customAction) {
                        "back_step" -> player.seekTo(maxOf(0L, player.currentPosition - prefs.getInt("notif_back", 10) * 1000L))
                        "boost" -> { // устаревший командный буст — теперь живёт в DSP; принимаем для совместимости
                            Dsp.state.boostPercent = 100 + args.getInt("mb", 0) / 10
                        }
                    }
                    return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }

                override fun onAddMediaItems(s: MediaSession, c: MediaSession.ControllerInfo, items: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> =
                    Futures.immediateFuture(items.map { it.buildUpon().setUri(it.mediaId).build() }.toMutableList())
            }).build()
    }

    /** Плавное затухание 10 с для таймера сна (2.4): флаг Dsp.state.sleepToZero ставит VM. */
    private val fadeTick = object : Runnable {
        override fun run() {
            val goal = if (Dsp.state.sleepToZero) 0f else 1f
            if (goal < 1f || fading) {
                curVol += 0.1f * (goal - curVol); fading = true
                player.volume = curVol.coerceIn(0f, 1f)
                if (Dsp.state.sleepToZero && curVol < 0.02f) { // пауза после затухания, громкость восстановить
                    player.pause(); curVol = 1f; player.volume = 1f; fading = false
                }
            }
            if (fading || Dsp.state.sleepToZero) h.postDelayed(this, 250)
        }
    }
    private var curVol = 1f; private var fading = false
    private fun startFadeLoop() { fading = Dsp.state.sleepToZero; if (fading) h.postDelayed(fadeTick, 250) }

    /** FR-11: умная перемотка назад при возобновлении после долгой паузы. */
    private fun applySmartRewind() {
        if (!prefs.getBoolean("smart_rewind", true)) return
        val id = player.currentMediaItem?.mediaMetadata?.extras?.getLong("book") ?: return
        val last = prefs.getLong("pausedAt_$id", 0)
        if (last == 0L) return
        val gap = System.currentTimeMillis() - last
        val back = when {
            gap > 864_000_000 -> 20_000L; gap > 3_600_000 -> 10_000L; gap > 60_000 -> 3_000L; else -> 0L
        }
        if (back > 0) player.seekTo(maxOf(0L, player.currentPosition - back))
    }

    fun markPausedNow() {
        val id = player.currentMediaItem?.mediaMetadata?.extras?.getLong("book") ?: return
        prefs.edit().putLong("pausedAt_$id", System.currentTimeMillis()).apply()
    }

    private fun markDone() {
        val id = player.currentMediaItem?.mediaMetadata?.extras?.getLong("book") ?: return
        scope.launch { Db.get(this@PlayerService).dao().setStatus(id, Status.DONE) }
    }

    private fun save() {
        val id = player.currentMediaItem?.mediaMetadata?.extras?.getLong("book") ?: return
        val i = player.currentMediaItemIndex; val p = player.currentPosition
        scope.launch { Db.get(this@PlayerService).dao().savePos(id, i, p, System.currentTimeMillis()) }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = session
    override fun onTaskRemoved(rootIntent: Intent?) { if (!player.playWhenReady) stopSelf() }
    override fun onDestroy() {
        save(); markPausedNow(); h.removeCallbacks(tick)
        session?.release(); player.release(); scope.cancel(); Dsp.processor = null; super.onDestroy()
    }
}
