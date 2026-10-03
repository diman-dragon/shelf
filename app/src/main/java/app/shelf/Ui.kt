package app.shelf

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import app.shelf.BuildConfig
import app.shelf.dsp.Profiles
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import java.io.File
import kotlin.math.roundToInt

val Bg = Color(0xFF14100D); val Sf = Color(0xFF1D1814); val Sf2 = Color(0xFF26201A)
val Gold = Color(0xFFC99A52); val Gold2 = Color(0xFFE0B060); val Tx = Color(0xFFF2E8D8); val Mute = Color(0xFFA39580)
val OnGold = Color(0xFF1A1005)
val Err = Color(0xFFD9534F)                                    // ошибка / сердце (ТЗ 3)
// Светлая тема: «тёплая бумага» (ТЗ 3)
val Paper = Color(0xFFF6F0E6); val CardL = Color(0xFFFFFBF3); val Ink = Color(0xFF2A2018); val GoldA = Color(0xFFB07A2A)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { App() }
    }
}

@Composable
fun App(vm: VM = viewModel()) {
    val perms = if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.READ_MEDIA_AUDIO, Manifest.permission.POST_NOTIFICATIONS)
    else arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.loadFolders() }
    LaunchedEffect(Unit) { ask.launch(perms) }

    LaunchedEffect(Unit) { if (!Profiles::ctx.isInitialized) Profiles.ctx = vm.app(); vm.restoreFromBackupIfNeeded() }
    var tab by remember { mutableIntStateOf(0) }
    var player by remember { mutableStateOf(false) }
    var folders by remember { mutableStateOf(false) }
    var sound by remember { mutableStateOf(false) }
    BackHandler(player || folders || sound) { when { sound -> sound = false; folders -> folders = false; else -> player = false } }

    MaterialTheme(colorScheme = if (vm.isDark()) darkColorScheme(primary = Gold, background = Bg, surface = Sf, onSurface = Tx, onBackground = Tx)
        else lightColorScheme(primary = GoldA, background = Paper, surface = CardL, onSurface = Ink, onBackground = Ink)) {
        Box(Modifier.fillMaxSize().background(if (vm.isDark()) Bg else Paper)) {
            Scaffold(containerColor = if (vm.isDark()) Bg else Paper, bottomBar = {
                Column {
                    if (vm.book != null) Mini(vm) { player = true }
                    NavigationBar(containerColor = if (vm.isDark()) Sf else CardL) {
                        listOf("🗄" to "Полка", "📖" to "Библиотека", "♬" to "Плейлисты", "⚙" to "Настройки").forEachIndexed { i, (ic, l) ->
                            NavigationBarItem(selected = tab == i, onClick = { tab = i }, icon = { Text(ic, fontSize = 22.sp) }, label = { Text(l) },
                                colors = NavigationBarItemDefaults.colors(selectedIconColor = Gold, selectedTextColor = Gold, indicatorColor = Color.Transparent,
                                    unselectedIconColor = Mute, unselectedTextColor = Mute))
                        }
                    }
                }
            }) { p ->
                Box(Modifier.padding(p).fillMaxSize()) {
                    when (tab) {
                        0 -> Shelf(vm, { vm.open(it); player = true }) { folders = true }
                        1 -> Library(vm) { vm.open(it); player = true }
                        2 -> Playlists(vm) { vm.open(it); player = true }
                        else -> Settings(vm, { folders = true }, sound)
                    }
                    vm.scanning?.let { Column(Modifier.align(Alignment.TopCenter).statusBarsPadding()) { LinearProgressIndicator(Modifier.fillMaxWidth(), color = Gold); Text(it, color = Mute, fontSize = 12.sp, modifier = Modifier.padding(4.dp)) } }
                }
            }
            if (player) Player(vm) { player = false }
            if (folders) Folders(vm) { folders = false }
            if (sound) Box(Modifier.fillMaxSize().background(if (vm.isDark()) Bg else Paper).statusBarsPadding()) { SoundScreen({ sound = false }) }
        }
    }
}

@Composable
fun Cover(b: Book, mod: Modifier = Modifier) {
    val hue = (b.title.hashCode() and 0x7fffffff) % 360
    Box(mod.background(Brush.linearGradient(listOf(Color.hsv(hue.toFloat(), .5f, .45f), Color.hsv(((hue + 40) % 360).toFloat(), .6f, .2f))))) {
        if (b.cover != null) AsyncImage(File(b.cover), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text(b.title.take(1).uppercase(), Modifier.align(Alignment.Center), color = Color(0xCCFFFFFF), fontSize = 36.sp, fontWeight = FontWeight.ExtraBold)
        Box(Modifier.fillMaxHeight().width(10.dp).background(Brush.horizontalGradient(listOf(Color(0x66000000), Color.Transparent))))
        if (b.count > 0 && b.posMs + b.posTrack > 0)
            Box(Modifier.align(Alignment.BottomStart).fillMaxWidth(((b.posTrack + .5f) / b.count).coerceIn(0f, 1f)).height(3.dp).background(Gold))
    }
}

@Composable
fun Empty(go: () -> Unit) = Column(Modifier.fillMaxSize().padding(32.dp), Arrangement.Center, Alignment.CenterHorizontally) {
    Text("📚", fontSize = 56.sp); Spacer(Modifier.height(8.dp))
    Text("Полка пуста", color = Tx, fontSize = 20.sp); Spacer(Modifier.height(4.dp))
    Text("Выберите папки с аудиокнигами и музыкой", color = Mute, textAlign = TextAlign.Center); Spacer(Modifier.height(16.dp))
    Button(go, colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = OnGold)) { Text("Выбрать папки") }
}

@Composable
fun Shelf(vm: VM, open: (Book) -> Unit, folders: () -> Unit) {
    val books = vm.books.collectAsState().value
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Text("Shelf", Modifier.padding(20.dp, 14.dp), color = Gold2, fontSize = 32.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold)
        if (books.isEmpty()) Empty(folders)
        else if (!vm.threeD) {
            // Выключатель «3D полка»: плоская сетка обложек без текстур (быстрее, меньше энергии)
            val per = vm.coverCols
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = 10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(books.chunked(per)) { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        row.forEach { b -> Cover(b, Modifier.weight(1f).aspectRatio(.66f).clip(RoundedCornerShape(8.dp)).clickable { open(b) }) }
                        repeat(per - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        } else {
            val per = if (vm.coverCols == 4) 4 else vm.coverCols
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = 10.dp).background(Brush.horizontalGradient(listOf(Color(0xFF3B2512), Color(0xFF1E130A), Color(0xFF3B2512))))) {
                items(books.chunked(per)) { row ->
                    Column(Modifier.padding(top = 18.dp)) {
                        Row(Modifier.padding(horizontal = 14.dp), Arrangement.spacedBy(14.dp), Alignment.Bottom) {
                            row.forEach { b ->
                                // толщина зависит от длительности: длинные книги шире; высота слегка различается
                                val w = 1f + (b.durationMs / 3_600_000f).coerceIn(0f, 2f) * 0.35f
                                Cover(b, Modifier.weight(w).height((150 + (b.title.hashCode() and 31)).dp)
                                    .shadow(10.dp, RoundedCornerShape(4.dp, 8.dp, 8.dp, 4.dp))
                                    .graphicsLayer { rotationY = -10f; cameraDistance = 14 * density }.clickable { open(b) })
                            }
                            repeat(per - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                        Box(Modifier.fillMaxWidth().height(14.dp).shadow(8.dp).background(Brush.verticalGradient(listOf(Color(0xFF8A5A30), Color(0xFF3B2512)))))
                    }
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

@Composable
fun Library(vm: VM, open: (Book) -> Unit) {
    var q by remember { mutableStateOf("") }
    val base = vm.books.collectAsState().value
    val list = vm.search(vm.applyFilter(vm.sorted(base)), q)
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
        Text("Библиотека", Modifier.padding(vertical = 14.dp), color = Tx, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
        OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth(), placeholder = { Text("Поиск по названию, автору, чтецу…", color = Mute) }, singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Tx, unfocusedTextColor = Tx, focusedBorderColor = Gold, unfocusedBorderColor = Sf2, cursorColor = Gold))
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FilterChip(vm.filter.status == -1, { vm.setFilter(vm.filter.copy(status = -1)) }, { Text("Все", fontSize = 12.sp) })
            FilterChip(vm.filter.status == Status.ACTIVE, { vm.setFilter(vm.filter.copy(status = if (vm.filter.status == Status.ACTIVE) -1 else Status.ACTIVE)) }, { Text("В процессе", fontSize = 12.sp) })
            FilterChip(vm.filter.status == Status.DONE, { vm.setFilter(vm.filter.copy(status = if (vm.filter.status == Status.DONE) -1 else Status.DONE)) }, { Text("Прослушанные", fontSize = 12.sp) })
            FilterChip(vm.sort == SortBy.Title, { vm.setSort(SortBy.Title) }, { Text("А–Я", fontSize = 12.sp) })
            FilterChip(vm.sort == SortBy.LastPlayed, { vm.setSort(SortBy.LastPlayed) }, { Text("Недавние", fontSize = 12.sp) })
        }
        LazyColumn(Modifier.weight(1f)) {
            items(list, key = { it.id }) { b ->
                Row(Modifier.fillMaxWidth().clickable { open(b) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Cover(b, Modifier.size(56.dp, 84.dp).clip(RoundedCornerShape(6.dp)))
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(b.title + if (b.fav) " ♥" else "", color = if (b.unavailable) Mute else Tx, fontSize = 16.sp, maxLines = 2)
                        Text(listOf(b.author, b.reader).filter { it.isNotEmpty() }.joinToString(" · "), color = Mute, fontSize = 13.sp, maxLines = 1)
                        Text(fmt(b.durationMs) + when (b.status) { Status.DONE -> " · прослушана"; Status.ACTIVE -> " · в процессе"; else -> "" } +
                            if (b.unavailable) " · файл недоступен" else "", color = if (b.unavailable) Err else Mute, fontSize = 13.sp)
                    }
                    Box {
                        TextButton({ vm.menuId = b.id }) { Text("⋮", color = Mute, fontSize = 20.sp) }
                        DropdownMenu(expanded = vm.menuId == b.id, onDismissRequest = { vm.hideBookMenu() }) { BookMenu(vm, b) }
                    }
                }
            }
        }
    }
}

@Composable
fun Mini(vm: VM, open: () -> Unit) {
    val b = vm.book ?: return
    Row(Modifier.fillMaxWidth().background(Sf2).clickable { open() }.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Cover(b, Modifier.size(40.dp).clip(RoundedCornerShape(6.dp))); Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) { Text(b.title, color = Tx, maxLines = 1); Text(vm.tracks.getOrNull(vm.index)?.title ?: "", color = Mute, fontSize = 12.sp, maxLines = 1) }
        TextButton({ vm.toggle() }) { Text(if (vm.playing) "❚❚" else "▶", color = Gold, fontSize = 22.sp) }
    }
}

@Composable
fun Player(vm: VM, close: () -> Unit) {
    val b = vm.book ?: return
    var queue by remember { mutableStateOf(false) }
    var speedSheet by remember { mutableStateOf(false) }
    var timerSheet by remember { mutableStateOf(false) }
    var bmSheet by remember { mutableStateOf(false) }
    var sound by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { Profiles.currentBook = b.id }
    LaunchedEffect(vm.playing) { while (vm.playing) { vm.tick(); delay(500) } }
    if (sound) { SoundScreen({ sound = false }, b.id); return }
    Column(Modifier.fillMaxSize().background(Bg).statusBarsPadding().navigationBarsPadding().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween) {
            TextButton(close) { Text("←", color = Tx, fontSize = 24.sp) }
            Row {
                TextButton({ soundOn.value = true }) { Text("🎚", color = Gold, fontSize = 22.sp) } // «Звук» (раздел 5)
                TextButton({ queue = true }) { Text("☰", color = Gold, fontSize = 22.sp) }   // очередь/главы (FR-16)
            }
        }
        Cover(b, Modifier.fillMaxWidth(.8f).aspectRatio(1f).shadow(24.dp, RoundedCornerShape(18.dp)).clip(RoundedCornerShape(18.dp)))
        Spacer(Modifier.height(18.dp))
        Text(b.title, color = Tx, fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2)
        Text(b.author, color = Gold2, fontSize = 16.sp)
        Text("Глава ${vm.index + 1} из ${vm.tracks.size}", color = Mute, fontSize = 14.sp)
        Spacer(Modifier.weight(1f))
        // прогресс: тап по времени переключает «глава / вся книга» (2.4)
        Slider(vm.sliderFraction(), { vm.sliderSeek(it) },
            colors = SliderDefaults.colors(thumbColor = Gold, activeTrackColor = Gold, inactiveTrackColor = Sf2))
        Row(Modifier.fillMaxWidth().clickable { vm.toggleWhole() }, Arrangement.SpaceBetween) {
            Text(if (vm.wholeBook) fmt(vm.bookElapsed()) else fmt(vm.pos), color = Mute, fontSize = 13.sp)
            Text(if (vm.wholeBook) "−" + fmt(vm.bookTotal() - vm.bookElapsed()) else "−" + fmt(vm.dur - vm.pos), color = Mute, fontSize = 13.sp)
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), Arrangement.SpaceEvenly, Alignment.CenterVertically) {
            TextButton({ vm.skipBack() }) { Text("↺ ${vm.stepBack}", color = Tx, fontSize = 20.sp) }
            Box(Modifier.size(76.dp).clip(CircleShape).background(Gold).clickable { vm.toggle() }, contentAlignment = Alignment.Center) {
                Text(if (vm.playing) "❚❚" else "▶", color = OnGold, fontSize = 26.sp)
            }
            TextButton({ vm.skipFwd() }) { Text("${vm.stepFwd} ↻", color = Tx, fontSize = 20.sp) }
        }
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceEvenly) {
            TextButton({ speedSheet = true }) { Text("⏩ ${vm.speed}×", color = Tx) }
            TextButton({ timerSheet = true }) { Text(if (vm.sleepMin != 0) "⏰ ${if (vm.sleepMin > 0) "${vm.sleepMin} мин" else "глава"}" else "⏰ Таймер",
                color = if (vm.sleepMin != 0) Gold else Tx) }
            TextButton({ queue = true }) { Text("☰ Очередь", color = Tx) }
            TextButton({ bmSheet = true }) { Text("🔖", color = Tx, fontSize = 20.sp) }
        }
    }
    // ---- лист глав и очереди (FR-16) ----
    if (queue) AlertDialog(onDismissRequest = { queue = false }, containerColor = Sf, confirmButton = { TextButton({ queue = false }) { Text("Закрыть", color = Gold) } },
        title = { Text("Главы", color = Tx) }, text = {
            LazyColumn { items(vm.tracks) { t -> Text("${t.idx + 1}. ${t.title}", Modifier.fillMaxWidth().clickable { vm.jump(t.idx); queue = false }.padding(vertical = 10.dp),
                color = if (t.idx == vm.index) Gold else Tx) } }
        })
    // ---- скорость 0.5–3.0× (лист) ----
    if (speedSheet) AlertDialog(onDismissRequest = { speedSheet = false }, containerColor = Sf,
        confirmButton = { TextButton({ speedSheet = false }) { Text("Закрыть", color = Gold) } },
        title = { Text("Скорость", color = Tx) }, text = {
            LazyColumn { items((0..10).map { 0.5f + it * 0.25f }) { v ->
                Text(String.format("%.2f×", v), Modifier.fillMaxWidth().clickable { vm.setSpeed(v); speedSheet = false }.padding(vertical = 10.dp),
                    color = if (v == vm.speed) Gold else Tx) } }
        })
    // ---- таймер сна: 15/30/45/60, до конца главы, выкл (затухание 10 с — сервис) ----
    if (timerSheet) AlertDialog(onDismissRequest = { timerSheet = false }, containerColor = Sf,
        confirmButton = { TextButton({ timerSheet = false }) { Text("Закрыть", color = Gold) } },
        title = { Text("Таймер сна", color = Tx) }, text = {
            Column { listOf(15, 30, 45, 60).forEach { m -> Text("$m мин", Modifier.fillMaxWidth().clickable { vm.setSleep(m); timerSheet = false }.padding(vertical = 10.dp), color = if (vm.sleepMin == m) Gold else Tx) }
                Text("До конца главы", Modifier.fillMaxWidth().clickable { vm.setSleepEndChapter(); timerSheet = false }.padding(vertical = 10.dp), color = if (vm.sleepMin == -1) Gold else Tx)
                Text("Выключить", Modifier.fillMaxWidth().clickable { vm.cancelSleep(); timerSheet = false }.padding(vertical = 10.dp), color = Mute) }
        })
    // ---- закладки (FR-15): одно касание — добавить с временем, список, переход, удаление ----
    if (bmSheet) AlertDialog(onDismissRequest = { bmSheet = false }, containerColor = Sf,
        confirmButton = { TextButton({ vm.addBookmark(); bmSheet = false }) { Text("+ Закладка сейчас", color = Gold) } },
        dismissButton = { TextButton({ bmSheet = false }) { Text("Закрыть", color = Mute) } },
        title = { Text("Закладки", color = Tx) }, text = {
            LazyColumn { items(vm.bmList) { x ->
                Row(Modifier.fillMaxWidth().clickable { vm.gotoBookmark(x); bmSheet = false }.padding(vertical = 8.dp), Arrangement.SpaceBetween) {
                    Text("Гл. ${x.trackIdx + 1} · ${fmt(x.ms)}${if (x.note.isNotEmpty()) " · ${x.note}" else ""}", color = Tx)
                    TextButton({ vm.delBookmark(x) }) { Text("✕", color = Mute) }
                } } }
        })
}

@Composable
fun Folders(vm: VM, close: () -> Unit) {
    LaunchedEffect(Unit) { vm.loadFolders() }
    // FR-03: папки вне индекса MediaStore (.nomedia) — через системный выбор SAF
    val saf = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { u -> u?.let { vm.addSafTree(it) } }
    Column(Modifier.fillMaxSize().background(Bg).statusBarsPadding().navigationBarsPadding().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Text("Выбор папок", color = Tx, fontSize = 22.sp, fontWeight = FontWeight.SemiBold); TextButton(close) { Text("✕", color = Mute, fontSize = 20.sp) }
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), Arrangement.SpaceBetween) { Text("Папки с аудио", color = Tx); Text("${vm.selected.size} выбрано", color = Mute) }
        if (vm.folders.isEmpty()) Text("Аудиофайлы не найдены или нет доступа к медиафайлам", Modifier.weight(1f).padding(16.dp), color = Mute)
        else LazyColumn(Modifier.weight(1f)) {
            items(vm.folders, key = { it.path }) { f ->
                Row(Modifier.fillMaxWidth().clickable { if (!f.saf) vm.toggleFolder(f.path) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(f.path in vm.selected, { vm.toggleFolder(f.path) }, enabled = !f.saf,
                        colors = CheckboxDefaults.colors(checkedColor = Gold, checkmarkColor = OnGold, uncheckedColor = Mute))
                    Text(if (f.saf) "🔓" else "📁", fontSize = 24.sp); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) { Text(f.path.substringAfterLast('/').ifBlank { f.path }, color = Tx); Text(f.path, color = Mute, fontSize = 12.sp, maxLines = 1) }
                    if (f.saf) TextButton({ vm.removeSaf(f.path) }) { Text("✕", color = Mute) } else Text("${f.count}", color = Mute)
                }
            }
        }
        TextButton({ saf.launch(null) }) { Text("+ Выбрать другую папку (SAF)", color = Gold) }
        val sel = vm.folders.filter { it.path in vm.selected }
        Text("Будет просканировано: ${sel.size} папок", color = Mute, fontSize = 13.sp)
        Text("Найдено аудиофайлов: ${sel.sumOf { it.count }}", color = Mute, fontSize = 13.sp)
        Text("MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV, WMA", color = Mute, fontSize = 12.sp, modifier = Modifier.padding(bottom = 10.dp))
        Button({ vm.scan(); close() }, Modifier.fillMaxWidth().height(52.dp), enabled = sel.isNotEmpty(),
            colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = OnGold)) { Text("Начать сканирование", fontWeight = FontWeight.SemiBold) }
        vm.scanning?.let { Row(Modifier.fillMaxWidth().padding(top = 8.dp), Arrangement.SpaceBetween) { LinearProgressIndicator(Modifier.weight(1f), color = Gold); TextButton({ vm.cancelScan() }) { Text("Отменить", color = Mute) } } }
    }
}

@Composable
fun Settings(vm: VM, folders: () -> Unit, soundOn: MutableState<Boolean>) {
    @Composable fun Sec(t: String) = Text(t, Modifier.padding(top = 22.dp, bottom = 6.dp), color = Mute, fontSize = 14.sp)
    @Composable fun Item(t: String, s: String, click: () -> Unit) = Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Sf).clickable { click() }.padding(16.dp), Arrangement.SpaceBetween) {
        Column { Text(t, color = Tx); Text(s, color = Mute, fontSize = 13.sp) }; Text("›", color = Mute, fontSize = 20.sp)
    }
    @Composable fun Sw(t: String, s: String, v: Boolean, on: (Boolean) -> Unit) =
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Sf).padding(16.dp), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text(t, color = Tx); Text(s, color = Mute, fontSize = 13.sp) }
            Switch(v, on, colors = SwitchDefaults.colors(checkedTrackColor = Gold, checkedThumbColor = OnGold))
        }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { u ->
        u?.let { runCatching { vm.app().contentResolver.openOutputStream(u)?.use { o -> o.write(vm.backupJson().toByteArray()) } } }
    }
    val import = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { u ->
        u?.let { runCatching { val t = vm.app().contentResolver.openInputStream(u)?.bufferedReader()?.readText(); if (t != null) vm.restore(t) } }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(16.dp)) {
        Text("Настройки", color = Tx, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
        Sec("Хранилище"); Item("Выбранные папки", "${vm.selected.size} папок", folders)
        Spacer(Modifier.height(8.dp)); Item("Пересканировать", vm.scanning ?: "Обновить библиотеку") { vm.scan() }
        Sec("Сканирование")
        Sw("Автосканирование", "При запуске и изменении файлов", vm.autoScan) { vm.setAutoScan(it) }
        Spacer(Modifier.height(8.dp)); Item("Минимальная длительность", "${vm.minDurSec} с") { vm.setMinDur(if (vm.minDurSec >= 60) 10 else vm.minDurSec + 10) }
        Spacer(Modifier.height(8.dp)); Item("Форматы", "MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV, WMA") {}
        Sec("Внешний вид")
        Sw("3D полка", "Реалистичный наклон книг; выкл — плоская сетка", vm.threeD) { vm.set3d(it) }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Sf).padding(16.dp), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Text("Тема", color = Tx); Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("Системная", "Тёмная", "Светлая").forEachIndexed { i, n -> FilterChip(i == vm.themeMode, { vm.setTheme(i) }, { Text(n, fontSize = 12.sp) }) }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Sf).padding(16.dp), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Text("Размер обложек", color = Tx); Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf(4 to "Малый", 3 to "Средний", 2 to "Большой").forEach { (c, n) -> FilterChip(vm.coverCols == c, { vm.setCols(c) }, { Text(n, fontSize = 12.sp) }) }
            }
        }
        Sec("Воспроизведение")
        Spacer(Modifier.height(8.dp)); Item("Шаги перемотки", "назад ${vm.stepBack} с · вперёд ${vm.stepFwd} с") { vm.setSteps(if (vm.stepBack >= 60) 5 else vm.stepBack + 5, vm.stepFwd) }
        Spacer(Modifier.height(8.dp)); Item("Шаг в шторке", "−${vm.notifBack} с") { vm.setNotifBack(if (vm.notifBack >= 30) 5 else vm.notifBack + 5) }
        Spacer(Modifier.height(8.dp)); Sw("Умная перемотка при возобновлении", ">1 мин −3 с, >1 ч −10 с, >1 дня −20 с", vm.smartRewind) { vm.setSmartRewind(it) }
        Spacer(Modifier.height(8.dp)); Sw("Пропуск тишины", "FR-13: SilenceSkippingAudioProcessor", vm.silenceSkip) { vm.setSilenceSkip(it) }
        Sec("Звук"); Item("Эквалайзер, усиление, лимитер", "Открыть экран «Звук»") { soundOn.value = true }
        Sec("Энергосбережение")
        Sw("Режим Эко", "Запись позиции раз в 30 с, offload без эффектов, авто при заряде < 20%", vm.eco) { vm.setEco(it) }
        Sec("Резервная копия")
        Spacer(Modifier.height(8.dp)); Item("Экспорт", "Позиции, статусы, плейлисты (JSON)") { export.launch("shelf-backup.json") }
        Spacer(Modifier.height(8.dp)); Item("Импорт", "Восстановить из файла") { import.launch(arrayOf("application/json")) }
        Sec("О приложении"); Item("Версия", BuildConfig.VERSION_NAME) {}
    }
}
