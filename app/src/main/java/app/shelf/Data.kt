package app.shelf

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity
data class Book(
    @PrimaryKey(autoGenerate = true) val id: Long = 0, val src: String, val title: String, val author: String,
    val durationMs: Long, val count: Int, val cover: String?, val addedAt: Long,
    val lastPlayed: Long = 0, val posTrack: Int = 0, val posMs: Long = 0
)

@Entity(indices = [Index("bookId")])
data class Track(
    @PrimaryKey(autoGenerate = true) val id: Long = 0, val bookId: Long, val idx: Int,
    val uri: String, val title: String, val durationMs: Long
)

@Dao
interface LibDao {
    @Query("SELECT * FROM Book ORDER BY lastPlayed DESC, addedAt DESC") fun books(): Flow<List<Book>>
    @Query("SELECT * FROM Book WHERE id = :id") suspend fun book(id: Long): Book?
    @Query("SELECT * FROM Book WHERE src = :s LIMIT 1") suspend fun findBySrc(s: String): Book?
    @Query("SELECT * FROM Track WHERE bookId = :id ORDER BY idx") suspend fun tracks(id: Long): List<Track>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putBook(b: Book): Long
    @Insert suspend fun putTracks(t: List<Track>)
    @Query("DELETE FROM Track WHERE bookId = :id") suspend fun deleteTracks(id: Long)
    @Query("UPDATE Book SET posTrack = :t, posMs = :ms, lastPlayed = :now WHERE id = :id") suspend fun savePos(id: Long, t: Int, ms: Long, now: Long)
    @Query("UPDATE Book SET cover = :c WHERE id = :id") suspend fun setCover(id: Long, c: String)
}

@Database(entities = [Book::class, Track::class], version = 1, exportSchema = false)
abstract class Db : RoomDatabase() {
    abstract fun dao(): LibDao
    companion object {
        @Volatile private var inst: Db? = null
        fun get(c: Context): Db = inst ?: synchronized(this) {
            inst ?: Room.databaseBuilder(c.applicationContext, Db::class.java, "shelf.db").build().also { inst = it }
        }
    }
}
