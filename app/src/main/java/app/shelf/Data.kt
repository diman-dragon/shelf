package app.shelf

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.flow.Flow

/** Статусы книги (FR-19): 0 не начата, 1 в процессе, 2 прослушана. */
object Status { const val NEW = 0; const val ACTIVE = 1; const val DONE = 2 }
/** Тип папки (FR-04). */
object Kind { const val BOOK = 0; const val MUSIC = 1 }

@Entity
data class Book(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val src: String,                       // путь к папке или URI дерева SAF
    val title: String, val author: String, val reader: String = "",
    val durationMs: Long, val count: Int,
    val cover: String?, val addedAt: Long,
    val lastPlayed: Long = 0, val posTrack: Int = 0, val posMs: Long = 0,
    val kind: Int = Kind.BOOK,             // книги / музыка
    val status: Int = Status.NEW,
    val fav: Boolean = false,
    val hidden: Boolean = false,
    val unavailable: Boolean = false,      // FR-09: файл удалён, позиция сохраняется
    val speed: Float = 1f,                 // FR-12: скорость запоминается для книги
    val replayGainDb: Float = 0f,          // 5.2: нормализация как коэффициент
    val profileId: Long = 0                // профиль звука (0 — общий)
)

@Entity(indices = [Index("bookId")])
data class Track(
    @PrimaryKey(autoGenerate = true) val id: Long = 0, val bookId: Long, val idx: Int,
    val uri: String, val title: String, val durationMs: Long
)

@Entity
data class Bookmark(
    @PrimaryKey(autoGenerate = true) val id: Long = 0, val bookId: Long,
    val trackIdx: Int, val ms: Long, val note: String = "", val createdAt: Long = 0
)

@Entity
data class Playlist(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String, val icon: Int = 0, val color: Int = 0, val ord: Int = 0
)

@Entity(indices = [Index("bookId", "playlistId")])
data class PlaylistItem(val bookId: Long, val playlistId: Long, val ord: Int)

@Dao
interface LibDao {
    @Query("SELECT * FROM Book WHERE hidden=0 ORDER BY lastPlayed DESC, addedAt DESC") fun books(): Flow<List<Book>>
    @Query("SELECT * FROM Book WHERE hidden=0 ORDER BY lastPlayed DESC, addedAt DESC") suspend fun booksNow(): List<Book>
    @Query("SELECT * FROM Book WHERE id = :id") suspend fun book(id: Long): Book?
    @Query("SELECT * FROM Book WHERE src = :s LIMIT 1") suspend fun findBySrc(s: String): Book?
    @Query("SELECT * FROM Track WHERE bookId = :id ORDER BY idx") suspend fun tracks(id: Long): List<Track>
    @Query("SELECT * FROM Track WHERE bookId = :id ORDER BY idx") fun tracksFlow(id: Long): Flow<List<Track>>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putBook(b: Book): Long
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun putTracks(t: List<Track>)
    @Query("DELETE FROM Track WHERE bookId = :id") suspend fun deleteTracks(id: Long)
    @Query("UPDATE Book SET posTrack = :t, posMs = :ms, lastPlayed = :now, status = CASE WHEN status = 0 THEN 1 ELSE status END WHERE id = :id")
    suspend fun savePos(id: Long, t: Int, ms: Long, now: Long)
    @Query("UPDATE Book SET cover = :c WHERE id = :id") suspend fun setCover(id: Long, c: String)
    @Query("UPDATE Book SET status = :s WHERE id = :id") suspend fun setStatus(id: Long, s: Int)
    @Query("UPDATE Book SET fav = NOT fav WHERE id = :id") suspend fun toggleFav(id: Long)
    @Query("UPDATE Book SET hidden = 1 WHERE id = :id") suspend fun hide(id: Long)
    @Query("UPDATE Book SET unavailable = :u WHERE id = :id") suspend fun setUnavailable(id: Long, u: Boolean)
    @Query("UPDATE Book SET speed = :v WHERE id = :id") suspend fun setSpeed(id: Long, v: Float)
    @Query("UPDATE Book SET replayGainDb = :v WHERE id = :id") suspend fun setReplayGain(id: Long, v: Float)
    @Query("UPDATE Book SET kind = :k WHERE id = :id") suspend fun setKind(id: Long, k: Int)
    @Query("UPDATE Book SET reader = :r WHERE id = :id") suspend fun setReader(id: Long, r: String)
    @Query("DELETE FROM Book WHERE id = :id") suspend fun deleteBook(id: Long)

    // закладки (FR-15)
    @Query("SELECT * FROM Bookmark WHERE bookId = :b ORDER BY trackIdx, ms") fun bookmarks(b: Long): Flow<List<Bookmark>>
    @Query("SELECT * FROM Bookmark WHERE bookId = :b ORDER BY trackIdx, ms") suspend fun bookmarksOf(b: Long): List<Bookmark>
    @Insert suspend fun putBookmark(x: Bookmark)
    @Query("DELETE FROM Bookmark WHERE id = :id") suspend fun delBookmark(id: Long)
    @Query("UPDATE Bookmark SET note = :n WHERE id = :id") suspend fun updateNote(id: Long, n: String)

    // плейлисты (FR-20)
    @Query("SELECT * FROM Playlist ORDER BY ord") fun playlists(): Flow<List<Playlist>>
    @Query("SELECT * FROM Playlist ORDER BY ord") suspend fun playlistsNow(): List<Playlist>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putPl(p: Playlist): Long
    @Query("UPDATE Playlist SET name = :n, icon = :i, color = :c WHERE id = :id") suspend fun updatePl(id: Long, n: String, i: Int, c: Int)
    @Query("DELETE FROM Playlist WHERE id = :id") suspend fun delPl(id: Long)
    @Query("DELETE FROM PlaylistItem WHERE playlistId = :id") suspend fun delPlItems(id: Long)
    @Query("SELECT bookId FROM PlaylistItem WHERE playlistId = :p ORDER BY ord") suspend fun plBooks(p: Long): List<Long>
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun plAdd(bookId: Long, playlistId: Long, ord: Int)
    @Query("DELETE FROM PlaylistItem WHERE bookId = :b AND playlistId = :p") suspend fun plRemove(b: Long, p: Long)
    @Query("DELETE FROM PlaylistItem WHERE playlistId = :p") suspend fun plClear(p: Long)
}

@Database(entities = [Book::class, Track::class, Bookmark::class, Playlist::class, PlaylistItem::class], version = 2, exportSchema = false)
abstract class Db : RoomDatabase() {
    abstract fun dao(): LibDao
    companion object {
        @Volatile private var inst: Db? = null
        fun get(c: Context): Db = inst ?: synchronized(this) {
            inst ?: Room.databaseBuilder(c.applicationContext, Db::class.java, "shelf.db")
                .fallbackToDestructiveMigration().build().also { inst = it }
        }
    }
}
