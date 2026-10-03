package app.shelf

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Набор значков плейлистов (2.5): сердце, машина, планета, книга, мозг, документ. */
private val PlIcons = listOf("♥", "🚗", "🪐", "📖", "🧠", "📄")
private val PlColors = listOf(0xFFD9534F, 0xFF5B8FD9, 0xFF7BC96F, 0xFFC9A152, 0xFF9B6FD9, 0xFF52C9B8).map { Color(0xFF00000000L or it.toLong()) }

/** Кнопка «⋮» книги: статусы (FR-19), избранное, добавить в плейлист (FR-20), скрыть/удалить. */
@Composable
fun BookMenu(vm: VM, b: Book) {
    var plPicker by remember { mutableStateOf(false) }
    val pls by vm.playlists.collectAsState()
    Column {
        TextButton({ vm.setStatus(b.id, Status.NEW); vm.hideBookMenu() }) { Text("▶ Не начата", color = Tx, fontSize = 14.sp) }
        TextButton({ vm.setStatus(b.id, Status.ACTIVE); vm.hideBookMenu() }) { Text("… В процессе", color = Tx, fontSize = 14.sp) }
        TextButton({ vm.setStatus(b.id, Status.DONE); vm.hideBookMenu() }) { Text("✓ Прослушана", color = Tx, fontSize = 14.sp) }
        TextButton({ vm.toggleFav(b.id); vm.hideBookMenu() }) { Text(if (b.fav) "♥ Убрать из избранного" else "♥ В избранное", color = if (b.fav) Err else Tx, fontSize = 14.sp) }
        TextButton({ plPicker = true }) { Text("＋ В плейлист", color = Tx, fontSize = 14.sp) }
        TextButton({ vm.hideBook(b.id); vm.hideBookMenu() }) { Text("Скрыть с полки", color = Mute, fontSize = 14.sp) }
        TextButton({ vm.removeBook(b.id); vm.hideBookMenu() }) { Text("Удалить из библиотеки", color = Err, fontSize = 14.sp) }
    }
    if (plPicker) AlertDialog(onDismissRequest = { plPicker = false }, containerColor = Sf,
        confirmButton = { TextButton({ plPicker = false }) { Text("Закрыть", color = Gold) } },
        title = { Text("Добавить в плейлист", color = Tx) }, text = {
            Column {
                pls.forEach { p -> Text(p.name, Modifier.fillMaxWidth().clickable { vm.addToPlaylist(b.id, p.id); plPicker = false }.padding(vertical = 10.dp), color = Tx) }
                if (pls.isEmpty()) Text("Нет плейлистов — создайте на вкладке «Плейлисты»", color = Mute)
            }
        })
}

/** Экран «Плейлисты» (2.5): системные умные + пользовательские, создание, «Слушать подряд». */
@Composable
fun Playlists(vm: VM, open: (Book) -> Unit) {
    var sel by remember { mutableStateOf<Playlist?>(null) }      // просмотр плейлиста
    var edit by remember { mutableStateOf<Playlist?>(null) }     // переименование
    var creating by remember { mutableStateOf(false) }
    val all by vm.books.collectAsState()
    val pls by vm.playlists.collectAsState()

    if (sel != null) { PlaylistDetail(vm, sel!!, { b -> vm.open(b) }) { sel = null }; return }
    if (edit != null || creating) {
        PlEditor(vm, editing = edit, close = { edit = null; creating = false }); return
    }

    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Text("Плейлисты", color = Tx, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            TextButton({ creating = true }) { Text("+", color = Gold, fontSize = 26.sp) }
        }
        LazyColumn(Modifier.weight(1f)) {
            item { SectionTitle("Системные") }
            items(listOf("Избранное" to -1, "В процессе" to Status.ACTIVE, "Не начатые" to Status.NEW)) { (name, st) ->
                val cnt = all.count { if (st < 0) it.fav else it.status == st }
                PlRow(if (st < 0) "♥" else if (st == Status.ACTIVE) "▶" else "·", Gold, name, "$cnt аудиокниг") {
                    sel = Playlist(id = -1000L - st, name = name, icon = 0, color = 0)
                }
            }
            item { SectionTitle("Мои") }
            items(pls, key = { it.id }) { p ->
                PlRow(PlIcons.getOrElse(p.icon) { "♪" }, PlColors.getOrElse(p.color) { Gold }, p.name, "${vm.playlistBooksCount(p.id)} книг",
                    onEdit = { edit = p }) { sel = p }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable private fun SectionTitle(t: String) = Text(t, color = Mute, fontSize = 14.sp, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))

@Composable
private fun PlRow(icon: String, color: Color, name: String, sub: String, onEdit: (() -> Unit)? = null, open: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Sf).clickable { open() }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp).clip(CircleShape).background(color.copy(alpha = .22f)), contentAlignment = Alignment.Center) { Text(icon, color = color, fontSize = 20.sp) }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) { Text(name, color = Tx, fontSize = 16.sp); Text(sub, color = Mute, fontSize = 13.sp) }
        if (onEdit != null) TextButton(onEdit) { Text("⋮", color = Mute, fontSize = 20.sp) }
        Text("›", color = Mute, fontSize = 20.sp)
    }
    Spacer(Modifier.height(6.dp))
}

/** Виртуальные системные плейлисты (умные, не редактируются) — id: -1 избранное, -2 в процессе, -3 не начатые. */
@Composable
fun PlaylistDetail(vm: VM, pl: Playlist, open: (Book) -> Unit, back: () -> Unit) {
    val all by vm.books.collectAsState()
    val books by remember(pl.id, vm.plTick) {
        derivedStateOf {
            when (pl.id) {
                -1L -> all.filter { it.fav }
                -2L -> all.filter { it.status == Status.ACTIVE }
                -3L -> all.filter { it.status == Status.NEW }
                else -> vm.playlistBooksSync(pl.id, all)
            }
        }
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(back) { Text("←", color = Tx, fontSize = 24.sp) }
            Text(pl.name, color = Tx, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        }
            Button({ vm.playFrom(books) }, enabled = books.isNotEmpty(),
            colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = OnGold)) { Text("Слушать подряд") }
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.weight(1f)) {
            if (books.isEmpty()) item { Text("Пусто", color = Mute, modifier = Modifier.padding(24.dp)) }
            items(books, key = { it.id }) { b ->
                Row(Modifier.fillMaxWidth().clickable { open(b) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Cover(b, Modifier.size(48.dp, 72.dp).clip(RoundedCornerShape(6.dp)))
                    Spacer(Modifier.width(12.dp))
                    Column { Text(b.title, color = Tx, maxLines = 2); Text(fmt(b.durationMs), color = Mute, fontSize = 13.sp) }
                }
            }
        }
    }
}

@Composable
private fun PlEditor(vm: VM, editing: Playlist?, close: () -> Unit) {
    var name by remember { mutableStateOf(editing?.name ?: "") }
    var icon by remember { mutableIntStateOf(editing?.icon ?: 0) }
    var color by remember { mutableIntStateOf(editing?.color ?: 0) }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(20.dp)) {
        Text(if (editing == null) "Новый плейлист" else "Изменить", color = Tx, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Название", color = Mute) },
            colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Tx, unfocusedTextColor = Tx, focusedBorderColor = Gold, unfocusedBorderColor = Sf2, cursorColor = Gold))
        Spacer(Modifier.height(12.dp))
        Text("Значок", color = Mute, fontSize = 13.sp)
        Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            PlIcons.forEachIndexed { i, ic -> Box(Modifier.size(44.dp).clip(CircleShape)
                .background(if (icon == i) Gold.copy(alpha = .3f) else Sf).clickable { icon = i }, contentAlignment = Alignment.Center) { Text(ic, fontSize = 20.sp) } }
        }
        Text("Цвет", color = Mute, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
        Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PlColors.forEachIndexed { i, c -> Box(Modifier.size(36.dp).clip(CircleShape).background(c)
                .border(if (color == i) 3.dp else 0.dp, Gold, CircleShape).clickable { color = i }) }
        }
        Spacer(Modifier.weight(1f))
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(10.dp)) {
            if (editing != null) Button({ vm.deletePlaylist(editing.id); close() },
                colors = ButtonDefaults.buttonColors(containerColor = Err, contentColor = Color.White)) { Text("Удалить") }
            Button({ if (name.isNotBlank()) { if (editing != null) vm.renamePlaylist(editing.id, name, icon, color) else vm.createPlaylist(name, icon, color) }; close() },
                Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = OnGold)) { Text("Сохранить") }
            OutlinedButton(close) { Text("Отмена", color = Mute) }
        }
    }
}
