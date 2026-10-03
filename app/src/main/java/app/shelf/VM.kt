package app.shelf

import android.app.Application
import android.content.ComponentName
import android.content.ContentUris
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.File

data class Row(val id: Long, val path: String, val name: String, val dur: Long, val title: String?, val artist: String?, val album: String?)
data class Fold(val path: String, val count: Int)

fun natural(a: String, b: String): Int {
    val x = Regex("\\d+|\\D+").findAll(a.lowercase()).map { it.value }.toList()
    val y = Regex("\\d+|\\D+").findAll(b.lowercase()).map { it.value }.toList()
    for (i in 0 until minOf(x.size, y.size)) {
        val p = x[i]; val q = y[i]
        val c = if (p[0].isDigit() && q[0].isDigit()) p.toBigInteger().compareTo(q.toBigInteger()) else p.compareTo(q)
        if (c != 0) return c
    }
    return x.size - y.size
}

fun fmt(ms: Long): String {
    val s = maxOf(0L, ms) / 1000; val h = s / 3600; val m = s % 3600 / 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s % 60) else "%d:%02d".format(m, s % 60)
}

class VM(private val app: Application) : AndroidViewModel(app) {
    private val dao = Db.get(app).dao()
    private val prefs = app.getSharedPreferences("shelf", 0)
    val books = dao.books().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    var folders by mutableStateOf<List<Fold>>(emptyList()); private set
    var selected by mutableStateOf(prefs.getStringSet("folders", emptySet())!!.toSet()); private set
    var scanning by mutableStateOf<String?>(null); private set
    var threeD by mutableStateOf(prefs.getBoolean("3d", true)); private set

    var mc by mutableStateOf<MediaController?>(null); private set
    var book by mutableStateOf<Book?>(null); private set
    var tracks by mutableStateOf<List<Track>>(emptyList()); private set
    var playing by mutableStateOf(false); private set
    var index by mutableIntStateOf(0); private set
    var pos by mutableLongStateOf(0L); private set
    var dur by mutableLongStateOf(0L); private set
    var speed by mutableFloatStateOf(1f); private set
    var boostMb by mutableIntStateOf(0); private set
    var sleepMin by mutableIntStateOf(0); private set
    private var sleepJob: Job? = null

    init {
        val f = MediaController.Builder(app, SessionToken(app, ComponentName(app, PlayerService::class.java))).buildAsync()
        f.addListener({
            val c = f.get(); mc = c
            c.addListener(object : Player.Listener {
                override fun onEvents(p: Player, e: Player.Events) {
                    playing = p.isPlaying; index = p.currentMediaItemIndex; tick()
                    val id = p.currentMediaItem?.mediaMetadata?.extras?.getLong("book")
                    if (id != null && book?.id != id) viewModelScope.launch { book = dao.book(id); tracks = dao.tracks(id) }
                }
            })
        }, ContextCompat.getMainExecutor(app))
    }

    // ---------- воспроизведение ----------
    fun open(b: Book) = viewModelScope.launch {
        val c = mc ?: return@launch
        if (book?.id == b.id && c.mediaItemCount > 0) return@launch
        val ts = dao.tracks(b.id); if (ts.isEmpty()) return@launch
        book = b; tracks = ts
        val items = ts.map { t ->
            MediaItem.Builder().setMediaId(t.uri).setMediaMetadata(
                MediaMetadata.Builder().setTitle(t.title).setArtist(b.author).setAlbumTitle(b.title)
                    .setArtworkUri(b.cover?.let { Uri.fromFile(File(it)) })
                    .setExtras(Bundle().apply { putLong("book", b.id) }).build()).build()
        }
        c.setMediaItems(items, b.posTrack.coerceIn(0, items.lastIndex), b.posMs); c.prepare(); c.play()
    }
    fun tick() { mc?.let { pos = it.currentPosition; dur = maxOf(0L, it.duration) } }
    fun seek(ms: Long) { mc?.seekTo(ms); pos = ms }
    fun skip(d: Long) { mc?.let { it.seekTo((it.currentPosition + d).coerceAtLeast(0)); tick() } }
    fun toggle() { mc?.let { if (it.isPlaying) it.pause() else it.play() } }
    fun jump(i: Int) { mc?.seekTo(i, 0) }
    fun cycleSpeed() { val l = listOf(1f, 1.25f, 1.5f, 1.75f, 2f, .8f); speed = l[(l.indexOf(speed) + 1) % l.size]; mc?.setPlaybackSpeed(speed) }
    fun cycleBoost() {
        val l = listOf(0, 300, 600, 900); boostMb = l[(l.indexOf(boostMb) + 1) % l.size]
        mc?.sendCustomCommand(SessionCommand("boost", Bundle.EMPTY), Bundle().apply { putInt("mb", boostMb) })
    }
    fun cycleSleep() {
        val l = listOf(0, 15, 30, 60); sleepMin = l[(l.indexOf(sleepMin) + 1) % l.size]; sleepJob?.cancel()
        if (sleepMin > 0) sleepJob = viewModelScope.launch { delay(sleepMin * 60_000L); mc?.pause(); sleepMin = 0 }
    }

    // ---------- папки и сканирование (MediaStore: память и SD) ----------
    private fun query(): List<Row> {
        val out = mutableListOf<Row>(); val m = MediaStore.Audio.Media
        val sel = "${m.IS_RINGTONE}=0 AND ${m.IS_NOTIFICATION}=0 AND ${m.IS_ALARM}=0 AND ${m.DURATION}>=10000"
        app.contentResolver.query(m.EXTERNAL_CONTENT_URI,
            arrayOf(m._ID, m.DATA, m.DISPLAY_NAME, m.DURATION, m.TITLE, m.ARTIST, m.ALBUM), sel, null, null)?.use {
            while (it.moveToNext()) out += Row(it.getLong(0), it.getString(1) ?: "", it.getString(2) ?: "", it.getLong(3), it.getString(4), it.getString(5), it.getString(6))
        }
        return out
    }
    fun loadFolders() = viewModelScope.launch(Dispatchers.IO) {
        val list = query().groupBy { File(it.path).parent ?: "" }.map { Fold(it.key, it.value.size) }.sortedBy { it.path }
        folders = list
        if (selected.isEmpty()) selected = list.filter { Regex("music|audio|книг|books", RegexOption.IGNORE_CASE).containsMatchIn(it.path.substringAfterLast('/')) }.map { it.path }.toSet()
    }
    fun toggleFolder(p: String) { selected = if (p in selected) selected - p else selected + p }
    fun set3d(v: Boolean) { threeD = v; prefs.edit().putBoolean("3d", v).apply() }

    private fun cover(id: Long, r: Row): String? = runCatching {
        val m = MediaMetadataRetriever(); m.setDataSource(app, ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, r.id))
        val b = m.embeddedPicture; m.release()
        b?.let { File(app.filesDir, "cv$id.jpg").apply { writeBytes(it) }.path }
    }.getOrNull()

    fun scan() = viewModelScope.launch(Dispatchers.IO) {
        prefs.edit().putStringSet("folders", selected).apply()
        scanning = "Сканирую…"
        val groups = query().groupBy { File(it.path).parent ?: "" }.filterKeys { it in selected }
        var n = 0
        for ((dir, rows) in groups) {
            val ts = rows.sortedWith { a, b -> natural(a.name, b.name) }
            val ex = dao.findBySrc(dir)
            val albums = ts.mapNotNull { it.album }.distinct()
            val title = ex?.title ?: if (albums.size == 1 && ts.size > 1) albums[0] else File(dir).name
            val author = ts.firstNotNullOfOrNull { r -> r.artist?.takeIf { it != "<unknown>" } } ?: ""
            if (ex != null) dao.deleteTracks(ex.id)
            val id = dao.putBook(Book(id = ex?.id ?: 0, src = dir, title = title, author = author, durationMs = ts.sumOf { it.dur }, count = ts.size,
                cover = ex?.cover, addedAt = ex?.addedAt ?: System.currentTimeMillis(), lastPlayed = ex?.lastPlayed ?: 0, posTrack = ex?.posTrack ?: 0, posMs = ex?.posMs ?: 0))
            dao.putTracks(ts.mapIndexed { i, r ->
                Track(bookId = id, idx = i, uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, r.id).toString(),
                    title = r.title?.takeIf { it.isNotBlank() } ?: r.name.substringBeforeLast('.'), durationMs = r.dur)
            })
            if (ex?.cover == null) cover(id, ts[0])?.let { dao.setCover(id, it) }
            scanning = "Найдено книг: ${++n}"
        }
        scanning = null
    }
}
