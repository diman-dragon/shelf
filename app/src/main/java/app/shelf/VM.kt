package app.shelf

import android.app.Application
import android.content.ComponentName
import android.content.ContentUris
import android.content.Intent
import android.content.res.Configuration
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
import androidx.media3.session.SessionToken
import app.shelf.dsp.Dsp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.roundToInt

data class Row(val id: Long, val path: String, val name: String, val dur: Long,
               val title: String?, val artist: String?, val album: String?)
data class Fold(val path: String, val count: Int, val saf: Boolean = false)

/** Естественный порядок: 2 перед 10 (FR-05). */
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

/** Время Ч:ММ:СС (2.2). */
fun fmt(ms: Long): String {
    val s = maxOf(0L, ms) / 1000; val h = s / 3600; val m = s % 3600 / 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s % 60) else "%d:%02d".format(m, s % 60)
}

enum class SortBy { Title, Author, Added, LastPlayed, Progress, Duration }
/** Фильтр библиотеки (2.2): статус, тип, источник. */
data class Filter(val status: Int = -1, val kind: Int = -1, val source: Int = -1)

class VM(private val app: Application) : AndroidViewModel(app) {
    fun app(): Application = app
    val prefs = app.getSharedPreferences("shelf", 0)
    private val dao = Db.get(app).dao()
    val books = dao.books().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val playlists = dao.playlists().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val bookmarksTick = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    var plTick by mutableIntStateOf(0); private set

    var folders by mutableStateOf<List<Fold>>(emptyList()); private set
    var selected by mutableStateOf(prefs.getStringSet("folders", emptySet())!!.toSet()); private set
    var safTrees by mutableStateOf(prefs.getStringSet("saf", emptySet())!!.toSet()); private set
    var scanning by mutableStateOf<String?>(null); private set
    @Volatile var scanCancel = false

    // ---- настройки (2.6) ----
    var threeD by mutableStateOf(prefs.getBoolean("3d", true)); private set
    var themeMode by mutableIntStateOf(prefs.getInt("theme", 0)); private set        // 0 системная / 1 тёмная / 2 светлая
    var coverCols by mutableIntStateOf(prefs.getInt("cols", 3)); private set         // малый 4 / средний 3 / большой 2
    var eco by mutableStateOf(prefs.getBoolean("eco", false)); private set           // режим Эко (раздел 7)
    var stepBack by mutableIntStateOf(prefs.getInt("step_back", 15)); private set    // шаги перемотки 5–60 с
    var stepFwd by mutableIntStateOf(prefs.getInt("step_fwd", 15)); private set
    var notifBack by mutableIntStateOf(prefs.getInt("notif_back", 10)); private set  // «−10 с» в шторке (FR-31)
    var smartRewind by mutableStateOf(prefs.getBoolean("smart_rewind", true)); private set // FR-11
    var autoScan by mutableStateOf(prefs.getBoolean("auto_scan", true)); private set        // FR-07
    var silenceSkip by mutableStateOf(prefs.getBoolean("silence_skip", false)); private set // FR-13
    var minDurSec by mutableIntStateOf(prefs.getInt("min_dur", 10)); private set            // FR-08
    var shakeExtend by mutableStateOf(prefs.getBoolean("shake", false)); private set        // S, выкл. по умолчанию

    var sort by mutableStateOf(SortBy.LastPlayed); private set
    var filter by mutableStateOf(Filter()); private set

    // ---- плеер ----
    var mc by mutableStateOf<MediaController?>(null); private set
    var book by mutableStateOf<Book?>(null); private set
    var tracks by mutableStateOf<List<Track>>(emptyList()); private set
    var playing by mutableStateOf(false); private set
    var index by mutableIntStateOf(0); private set
    var pos by mutableLongStateOf(0L); private set
    var dur by mutableLongStateOf(0L); private set
    var speed by mutableFloatStateOf(1f); private set
    var wholeBook by mutableStateOf(false); private set      // тап по времени: «глава / вся книга»
    var sleepMin by mutableIntStateOf(0); private set
    var sleepEndChapter by mutableStateOf(false); private set
    private var sleepJob: Job? = null
    var bmList by mutableStateOf<List<Bookmark>>(emptyList()); private set
    var volume by mutableFloatStateOf(prefs.getFloat("vol", 1f)); private set

    init {
        val f = MediaController.Builder(app, SessionToken(app, ComponentName(app, PlayerService::class.java))).buildAsync()
        f.addListener({
            val c = f.get(); mc = c
            c.addListener(object : Player.Listener {
                override fun onEvents(p: Player, e: Player.Events) {
                    playing = p.isPlaying; index = p.currentMediaItemIndex; tick()
                    val id = p.currentMediaItem?.mediaMetadata?.extras?.getLong("book")
                    if (id != null && book?.id != id) viewModelScope.launch {
                        book = dao.book(id); tracks = dao.tracks(id); refreshBm(id)
                        speed = dao.book(id)?.speed ?: 1f
                    }
                    if (sleepEndChapter && p.playbackState == Player.STATE_ENDED) {
                        sleepEndChapter = false; sleepMin = 0; Dsp.state.sleepToZero = false
                    }
                }
            })
            if (autoScan && books.value.isEmpty()) loadFolders()
        }, ContextCompat.getMainExecutor(app))
    }

    // ---------- воспроизведение ----------
    /** Открыть книгу: все главы в очередь ExoPlayer, позиция из БД (FR-10, FR-14 gapless). */
    fun open(b: Book) = viewModelScope.launch {
        val c = mc ?: return@launch
        if (book?.id == b.id && c.mediaItemCount > 0) return@launch
        val ts = dao.tracks(b.id); if (ts.isEmpty()) return@launch
        book = b; tracks = ts; refreshBm(b.id)
        val items = ts.map { t ->
            MediaItem.Builder().setMediaId(t.uri).setUri(t.uri).setMediaMetadata(
                MediaMetadata.Builder().setTitle(t.title).setArtist(b.author).setAlbumTitle(b.title)
                    .setArtworkUri(b.cover?.let { Uri.fromFile(File(it)) })
                    .setExtras(Bundle().apply { putLong("book", b.id) }).build()
            ).build()
        }
        c.setMediaItems(items, b.posTrack.coerceIn(0, items.lastIndex), b.posMs)
        speed = b.speed; c.setPlaybackSpeed(speed); c.volume = volume
        c.prepare(); c.play()
    }
    fun tick() { mc?.let { pos = it.currentPosition; dur = maxOf(0L, it.duration) } }
    fun seek(ms: Long) { mc?.seekTo(ms); pos = ms }
    /** Дробные шаги перемотки + вибрация на границах глав делает UI (2.4). */
    fun skip(d: Long) { mc?.let { it.seekTo((it.currentPosition + d).coerceAtLeast(0)); tick() } }
    fun toggle() { mc?.let { if (it.isPlaying) { it.pause(); markPaused() } else it.play() } }
    fun jump(i: Int) { mc?.seekTo(i, 0) }
    fun next() { mc?.seekToNextMediaItem() }
    fun prevOrRestart() { mc?.let { if (it.currentPosition > 3000) it.seekTo(it.currentMediaItemIndex, 0) else it.seekToPreviousMediaItem() } }
    fun setVolume(v: Float) { volume = v.coerceIn(0f, 1f); mc?.volume = volume; prefs.edit().putFloat("vol", volume).apply() }
    fun markPaused() { val id = book?.id ?: return; prefs.edit().putLong("pausedAt_$id", System.currentTimeMillis()).apply() }
    fun toggleWhole() { wholeBook = !wholeBook }

    /** Скорость 0.5–3.0× шагом 0.05, сохраняется для книги (FR-12). */
    fun setSpeed(v: Float) = viewModelScope.launch {
        speed = v.coerceIn(0.5f, 3f); mc?.setPlaybackSpeed(speed)
        book?.let { dao.setSpeed(it.id, speed) }
    }

    /** Прогресс «вся книга» для полоски и режима глава/книга (2.4). */
    fun bookTotal(): Long = tracks.sumOf { it.durationMs }.takeIf { it > 0 } ?: (book?.durationMs ?: 0L)
    fun bookElapsed(): Long = tracks.take(index).sumOf { it.durationMs } + pos
    fun sliderFraction(): Float =
        if (wholeBook && bookTotal() > 0) bookElapsed().toFloat() / bookTotal()
        else if (dur > 0) pos.toFloat() / dur else 0f
    fun sliderSeek(f: Float) {
        val c = mc ?: return
        if (wholeBook && bookTotal() > 0) {
            var rem = (f.coerceIn(0f, 1f) * bookTotal()).toLong()
            for (i in tracks.indices) { val d = tracks[i].durationMs; if (rem <= d) { c.seekTo(i, rem); break }; rem -= d }
        } else c.seekTo((f.coerceIn(0f, 1f) * c.duration).toLong())
        tick()
    }

    // ---------- таймер сна (2.4): 15/30/45/60, до конца главы, свой; затухание 10 с ----------
    /** Затухание выполняет сервис (fadeTick), поэтому таймер живёт даже при закрытом экране. */
    fun setSleep(min: Int) {
        sleepJob?.cancel(); sleepMin = min; sleepEndChapter = false; Dsp.state.sleepToZero = false
        if (min > 0) sleepJob = viewModelScope.launch {
            delay(maxOf(0L, min * 60_000L - 10_000L))
            Dsp.state.sleepToZero = true
            delay(11_000L)                       // сервис погасит громкость за ~10 с и поставит паузу
            Dsp.state.sleepToZero = false; sleepMin = 0
        }
    }
    fun setSleepEndChapter() { sleepJob?.cancel(); sleepMin = -1; sleepEndChapter = true }
    fun cancelSleep() { sleepJob?.cancel(); sleepMin = 0; sleepEndChapter = false; Dsp.state.sleepToZero = false }
    fun extendSleep() { if (sleepMin > 0) setSleep(sleepMin) } // «встряхнуть, чтобы продлить» (S)
    /** Цикл по пресетам таймера: выкл → 15 → 30 → 45 → 60 мин (2.4). */
    fun cycleSleep() { val l = listOf(0, 15, 30, 45, 60); setSleep(l[(l.indexOf(if (sleepMin > 0) sleepMin else 0) + 1) % l.size]) }
    /** Свой таймер сна, минуты. */
    fun setSleepCustom(min: Int) { setSleep(min.coerceIn(1, 600)) }

    // ---------- перемотка (2.4): шаги из настроек, умная перемотка FR-11 обрабатывается сервисом ----------
    fun skipBack() = skip(-stepBack * 1000L)
    fun skipFwd() = skip(stepFwd * 1000L)

    /** Лист скорости: цикл 0.5–3.0× шагом 0.25, сохраняется для книги (FR-12). */
    fun cycleSpeed() = viewModelScope.launch {
        val v = (((speed * 4).roundToInt() + 1) % 11) * 0.25f + 0.5f // 0.5..3.0
        speed = v.coerceIn(0.5f, 3f); mc?.setPlaybackSpeed(speed); book?.let { dao.setSpeed(it.id, speed) }
    }

    // ---------- закладки (FR-15) ----------
    private suspend fun refreshBm(id: Long) { bmList = dao.bookmarksOf(id) }
    fun addBookmark(note: String = "") = viewModelScope.launch {
        val b = book ?: return@launch
        dao.putBookmark(Bookmark(bookId = b.id, trackIdx = index, ms = pos, note = note, createdAt = System.currentTimeMillis()))
        refreshBm(b.id); bookmarksTick.emit(Unit)
    }
    fun gotoBookmark(x: Bookmark) { mc?.seekTo(x.trackIdx, x.ms) }
    fun delBookmark(x: Bookmark) = viewModelScope.launch { dao.delBookmark(x.id); book?.let { refreshBm(it.id) } }
    fun bookmarksFlow(id: Long) = dao.bookmarks(id)
    /** Экспорт закладок JSON (FR-15). */
    fun bookmarksJson(): String = JSONArray().apply {
        bmList.forEach { put(JSONObject().put("track", it.trackIdx).put("ms", it.ms).put("note", it.note)) }
    }.toString()

    // ---------- статусы, избранное, меню ⋮ (2.2, FR-19/20) ----------
    fun setStatus(id: Long, s: Int) = viewModelScope.launch { dao.setStatus(id, s) }
    fun toggleFav(id: Long) = viewModelScope.launch { dao.toggleFav(id) }
    fun hideBook(id: Long) = viewModelScope.launch { dao.hide(id) }
    fun removeBook(id: Long) = viewModelScope.launch { dao.deleteTracks(id); dao.deleteBook(id) } // файлы не удаляются
    fun setKind(id: Long, k: Int) = viewModelScope.launch { dao.setKind(id, k) }
    fun addToPlaylist(bookId: Long, plId: Long) = viewModelScope.launch {
        dao.plAdd(bookId, plId, (System.currentTimeMillis() % Int.MAX_VALUE).toInt()); plCache[plId] = dao.plBooks(plId); plTick++
    }
    fun removeFromPlaylist(bookId: Long, plId: Long) = viewModelScope.launch {
        dao.plRemove(bookId, plId); plCache[plId] = dao.plBooks(plId); plTick++
    }
    fun createPlaylist(name: String, icon: Int, color: Int) = viewModelScope.launch {
        dao.putPl(Playlist(name = name, icon = icon, color = color, ord = (System.currentTimeMillis() % Int.MAX_VALUE).toInt()))
    }
    fun renamePlaylist(id: Long, name: String, icon: Int, color: Int) = viewModelScope.launch { dao.updatePl(id, name, icon, color) }
    fun deletePlaylist(id: Long) = viewModelScope.launch { dao.delPlItems(id); dao.delPl(id); plCache.remove(id); plTick++ }
    suspend fun playlistBooks(id: Long): List<Book> = dao.plBooks(id).mapNotNull { dao.book(it) }
    /** Синхронный доступ для UI: кэш порядка книг плейлиста (обновляется при изменениях). */
    private val plCache = java.util.concurrent.ConcurrentHashMap<Long, List<Long>>()
    fun refreshPl(id: Long) = viewModelScope.launch { plCache[id] = dao.plBooks(id); plTick++ }
    fun playlistBooksCount(id: Long): Int { refreshPlIfNeeded(id); return plCache[id]?.size ?: 0 }
    fun playlistBooksSync(id: Long, all: List<Book>): List<Book> {
        refreshPlIfNeeded(id)
        val order = plCache[id] ?: return emptyList()
        return order.mapNotNull { i -> all.firstOrNull { it.id == i } }
    }
    private fun refreshPlIfNeeded(id: Long) { if (!plCache.containsKey(id)) refreshPl(id) }
    /** «Слушать подряд»: открываем первую книгу списка, остальные — очередь плеера при переходе. */
    fun playFrom(list: List<Book>, from: Int = 0) = viewModelScope.launch { list.getOrNull(from)?.let { open(it) } }

    // ---------- фильтр/сортировка/поиск (2.2) ----------
    fun progress(b: Book): Float {
        if (b.status == Status.DONE) return 1f
        if (b.durationMs <= 0 || b.count <= 0) return 0f
        val per = b.durationMs / b.count
        return ((b.posTrack * per + b.posMs).toFloat() / b.durationMs).coerceIn(0f, 1f)
    }
    private val primaryVol = android.os.Environment.getExternalStorageDirectory().absolutePath
    fun sorted(list: List<Book>): List<Book> {
        var l = list
        val f = filter
        if (f.status >= 0) l = l.filter { it.status == f.status }
        if (f.kind >= 0) l = l.filter { it.kind == f.kind }
        if (f.source >= 0) l = l.filter {
            val sd = it.src.startsWith("/storage/") && !it.src.startsWith(primaryVol)
            if (f.source == 1) sd else !sd
        }
        l = when (sort) {
            SortBy.Title -> l.sortedWith { a, b -> natural(a.title, b.title) }
            SortBy.Author -> l.sortedWith { a, b -> natural(a.author, b.author) }
            SortBy.Added -> l.sortedByDescending { it.addedAt }
            SortBy.LastPlayed -> l.sortedByDescending { it.lastPlayed }
            SortBy.Progress -> l.sortedByDescending { progress(it) }
            SortBy.Duration -> l.sortedByDescending { it.durationMs }
        }
        return l
    }
    /** Мгновенный поиск по названию, автору, чтецу (2.2; FTS5 — этап ядра, пока in-memory). */
    /** Фильтр по статусу/типу/источнику (2.2). */
    fun applyFilter(list: List<Book>): List<Book> = list.filter { b ->
        (filter.status < 0 || b.status == filter.status) &&
        (filter.kind < 0 || b.kind == filter.kind) &&
        (filter.source < 0 ||
         (filter.source == 1 && !b.src.startsWith("/storage/") && !b.src.startsWith("content")) ||
         (filter.source == 2 && (b.src.contains("sdcard") || b.src.contains("emulated") || b.src.startsWith("content"))))
    }
    fun search(list: List<Book>, q: String) = if (q.isBlank()) list else list.filter {
        it.title.contains(q, true) || it.author.contains(q, true) || it.reader.contains(q, true)
    }
    fun setSort(s: SortBy) { sort = s }
    fun setFilter(f: Filter) { filter = f }

    // ---------- применение настроек ----------
    fun set3d(v: Boolean) { threeD = v; prefs.edit().putBoolean("3d", v).apply() }
    fun setTheme(v: Int) { themeMode = v; prefs.edit().putInt("theme", v).apply() }
    fun isDark(): Boolean = when (themeMode) {
        1 -> true; 2 -> false
        else -> app.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK != Configuration.UI_MODE_NIGHT_NO
    }
    fun setCols(v: Int) { coverCols = v; prefs.edit().putInt("cols", v).apply() }
    fun setEco(v: Boolean) { eco = v; prefs.edit().putBoolean("eco", v).apply() }
    fun setSteps(back: Int, fwd: Int) { stepBack = back; stepFwd = fwd; prefs.edit().putInt("step_back", back).putInt("step_fwd", fwd).apply() }
    fun setNotifBack(v: Int) { notifBack = v; prefs.edit().putInt("notif_back", v).apply() }
    fun setSmartRewind(v: Boolean) { smartRewind = v; prefs.edit().putBoolean("smart_rewind", v).apply() }
    fun setAutoScan(v: Boolean) { autoScan = v; prefs.edit().putBoolean("auto_scan", v).apply() }
    fun setSilenceSkip(v: Boolean) { silenceSkip = v; prefs.edit().putBoolean("silence_skip", v).apply() }
    fun setMinDur(v: Int) { minDurSec = v; prefs.edit().putInt("min_dur", v).apply() }
    fun setShake(v: Boolean) { shakeExtend = v; prefs.edit().putBoolean("shake", v).apply() }

    // ---------- папки и сканирование (FR-01…FR-09) ----------
    private fun query(): List<Row> {
        val out = mutableListOf<Row>(); val m = MediaStore.Audio.Media
        val sel = "${m.IS_RINGTONE}=0 AND ${m.IS_NOTIFICATION}=0 AND ${m.IS_ALARM}=0 AND ${m.DURATION}>=" + (minDurSec * 1000)
        app.contentResolver.query(m.EXTERNAL_CONTENT_URI,
            arrayOf(m._ID, m.DATA, m.DISPLAY_NAME, m.DURATION, m.TITLE, m.ARTIST, m.ALBUM), sel, null, null)?.use {
            while (it.moveToNext()) out += Row(it.getLong(0), it.getString(1) ?: "", it.getString(2) ?: "",
                it.getLong(3), it.getString(4), it.getString(5), it.getString(6))
        }
        return out
    }
    fun loadFolders() = viewModelScope.launch(Dispatchers.IO) {
        val list = query().groupBy { File(it.path).parent ?: "" }.map { Fold(it.key, it.value.size) }.sortedBy { it.path }
        folders = list + safTrees.map { Fold(it, 0, saf = true) }
        if (selected.isEmpty()) selected = list.filter {
            Regex("music|audio|книг|books", RegexOption.IGNORE_CASE).containsMatchIn(it.path.substringAfterLast('/'))
        }.map { it.path }.toSet()
    }
    fun toggleFolder(p: String) { selected = if (p in selected) selected - p else selected + p }
    fun addSafTree(uri: Uri) = viewModelScope.launch(Dispatchers.IO) {
        runCatching { app.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        safTrees = safTrees + uri.toString(); prefs.edit().putStringSet("saf", safTrees).apply(); loadFolders()
    }
    fun cancelScan() { scanCancel = true }
    fun removeSaf(uri: String) { safTrees = safTrees - uri; prefs.edit().putStringSet("saf", safTrees).apply(); loadFolders() }

    private fun cover(id: Long, r: Row): String? = runCatching {
        val m = MediaMetadataRetriever()
        m.setDataSource(app, ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, r.id))
        val b = m.embeddedPicture; m.release()
        b?.let { File(app.filesDir, "cv$id.jpg").apply { writeBytes(it) }.path }
    }.getOrNull()

    fun scan() = viewModelScope.launch(Dispatchers.IO) {
        prefs.edit().putStringSet("folders", selected).apply()
        scanCancel = false
        scanning = "Сканирую…"
        val all = query()
        val groups = all.groupBy { File(it.path).parent ?: "" }.filterKeys { it in selected }
        var n = 0
        for ((dir, rows) in groups) {
            if (scanCancel) { scanning = null; return@launch }
            val ts = rows.sortedWith { a, b -> natural(a.name, b.name) }
            val ex = dao.findBySrc(dir)
            val albums = ts.mapNotNull { it.album }.distinct()
            // FR-04: папка = книга; один альбом у многих файлов = одна книга
            val title = ex?.title ?: if (albums.size == 1 && ts.size > 1) albums[0] else File(dir).name
            val author = ts.firstNotNullOfOrNull { r -> r.artist?.takeIf { it != "<unknown>" } } ?: ""
            if (ex != null) dao.deleteTracks(ex.id)
            val id = dao.putBook(Book(
                id = ex?.id ?: 0, src = dir, title = title, author = author, reader = ex?.reader ?: "",
                durationMs = ts.sumOf { it.dur }, count = ts.size, cover = ex?.cover,
                addedAt = ex?.addedAt ?: System.currentTimeMillis(), lastPlayed = ex?.lastPlayed ?: 0,
                posTrack = ex?.posTrack ?: 0, posMs = ex?.posMs ?: 0, kind = ex?.kind ?: Kind.BOOK,
                status = ex?.status ?: Status.NEW, fav = ex?.fav ?: false, hidden = ex?.hidden ?: false,
                speed = ex?.speed ?: 1f, replayGainDb = ex?.replayGainDb ?: 0f, unavailable = false))
            dao.putTracks(ts.mapIndexed { i, r ->
                Track(bookId = id, idx = i,
                    uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, r.id).toString(),
                    title = r.title?.takeIf { it.isNotBlank() } ?: r.name.substringBeforeLast('.'), durationMs = r.dur)
            })
            if (ex?.cover == null) cover(id, ts[0])?.let { dao.setCover(id, it) }
            scanning = "Найдено книг: ${++n}"
        }
        // FR-09: удалённые файлы помечаются недоступными, позиция сохраняется
        val liveDirs = all.mapNotNull { File(it.path).parent }.toSet()
        dao.booksNow().filter { !it.unavailable && it.src.startsWith("/") && it.src !in liveDirs }
            .forEach { dao.setUnavailable(it.id, true) }
        scanning = null
    }

    // ---------- резервная копия (раздел 6, S): позиции/статусы/избранное без аудио ----------
    /** Восстановление из ранее сохранённой копии (раздел 6). */
    fun restoreFromBackupFile() = viewModelScope.launch(Dispatchers.IO) {
        val f = File(app.filesDir, "shelf-backup.json"); if (!f.exists()) return@launch
        applyBackup(f.readText())
    }
    fun restoreFromBackupIfNeeded() = viewModelScope.launch(Dispatchers.IO) {
        if (prefs.getBoolean("restored", false)) return@launch
        val f = File(app.getExternalFilesDir(null), "shelf-backup.json")
        if (f.exists()) { applyBackup(f.readText()); prefs.edit().putBoolean("restored", true).apply() }
    }
    private suspend fun applyBackup(json: String) = withContext(Dispatchers.IO) {
        runCatching {
            val o = JSONObject(json)
            val arr = o.getJSONArray("books")
            for (i in 0 until arr.length()) {
                val x = arr.getJSONObject(i); val b = dao.book(x.getLong("id")) ?: continue
                dao.putBook(b.copy(posTrack = x.getInt("posTrack"), posMs = x.getLong("posMs"),
                    status = x.getInt("status"), fav = x.getBoolean("fav"), speed = x.getDouble("speed").toFloat()))
            }
        }
    }
    fun backupJson(): String {
        val o = JSONObject()
        o.put("app", "Shelf"); o.put("version", BuildConfig.VERSION_NAME)
        o.put("books", JSONArray().apply {
            kotlinx.coroutines.runBlocking(Dispatchers.IO) { dao.booksNow() }.forEach { b ->
                put(JSONObject().put("id", b.id).put("title", b.title).put("author", b.author)
                    .put("posTrack", b.posTrack).put("posMs", b.posMs).put("status", b.status)
                    .put("fav", b.fav).put("speed", b.speed))
            }
        })
        o.put("playlists", JSONArray().apply {
            kotlinx.coroutines.runBlocking(Dispatchers.IO) { dao.playlistsNow() }.forEach { p ->
                put(JSONObject().put("id", p.id).put("name", p.name).put("icon", p.icon).put("color", p.color))
            }
        })
        return o.toString(2)
    }
    fun restore(json: String): Int = kotlinx.coroutines.runBlocking(Dispatchers.IO) {
        var n = 0
        runCatching {
            val arr = JSONObject(json).getJSONArray("books")
            for (i in 0 until arr.length()) {
                val j = arr.getJSONObject(i); val b = dao.book(j.getLong("id")) ?: continue
                dao.putBook(b.copy(posTrack = j.getInt("posTrack"), posMs = j.getLong("posMs"),
                    status = j.getInt("status"), fav = j.getBoolean("fav"),
                    speed = j.getDouble("speed").toFloat()))
                n++
            }
        }
        n
    }
}
