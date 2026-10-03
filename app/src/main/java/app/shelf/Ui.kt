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
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import java.io.File

val Bg = Color(0xFF14100D); val Sf = Color(0xFF1D1814); val Sf2 = Color(0xFF26201A)
val Gold = Color(0xFFC99A52); val Gold2 = Color(0xFFE0B060); val Tx = Color(0xFFF2E8D8); val Mute = Color(0xFFA39580)
val OnGold = Color(0xFF1A1005)

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

    var tab by remember { mutableIntStateOf(0) }
    var player by remember { mutableStateOf(false) }
    var folders by remember { mutableStateOf(false) }
    BackHandler(player || folders) { if (folders) folders = false else player = false }

    MaterialTheme(colorScheme = darkColorScheme(primary = Gold, background = Bg, surface = Sf, onSurface = Tx, onBackground = Tx)) {
        Box(Modifier.fillMaxSize().background(Bg)) {
            Scaffold(containerColor = Bg, bottomBar = {
                Column {
                    if (vm.book != null) Mini(vm) { player = true }
                    NavigationBar(containerColor = Sf) {
                        listOf("🗄" to "Полка", "📖" to "Библиотека", "⚙" to "Настройки").forEachIndexed { i, (ic, l) ->
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
                        else -> Settings(vm) { folders = true }
                    }
                    vm.scanning?.let { Column(Modifier.align(Alignment.TopCenter).statusBarsPadding()) { LinearProgressIndicator(Modifier.fillMaxWidth(), color = Gold); Text(it, color = Mute, fontSize = 12.sp, modifier = Modifier.padding(4.dp)) } }
                }
            }
            if (player) Player(vm) { player = false }
            if (folders) Folders(vm) { folders = false }
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
        else LazyColumn(Modifier.fillMaxSize().padding(horizontal = 10.dp).background(Brush.horizontalGradient(listOf(Color(0xFF3B2512), Color(0xFF1E130A), Color(0xFF3B2512))))) {
            items(books.chunked(3)) { row ->
                Column(Modifier.padding(top = 18.dp)) {
                    Row(Modifier.padding(horizontal = 14.dp), Arrangement.spacedBy(14.dp), Alignment.Bottom) {
                        row.forEach { b ->
                            Cover(b, Modifier.weight(1f).aspectRatio(.66f).shadow(10.dp, RoundedCornerShape(4.dp, 8.dp, 8.dp, 4.dp))
                                .graphicsLayer { if (vm.threeD) { rotationY = -10f; cameraDistance = 14 * density } }.clickable { open(b) })
                        }
                        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                    Box(Modifier.fillMaxWidth().height(14.dp).shadow(8.dp).background(Brush.verticalGradient(listOf(Color(0xFF8A5A30), Color(0xFF3B2512)))))
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
fun Library(vm: VM, open: (Book) -> Unit) {
    var q by remember { mutableStateOf("") }
    val list = vm.books.collectAsState().value.filter { it.title.contains(q, true) || it.author.contains(q, true) }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
        Text("Библиотека", Modifier.padding(vertical = 14.dp), color = Tx, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
        OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth(), placeholder = { Text("Поиск по названию, автору…", color = Mute) }, singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Tx, unfocusedTextColor = Tx, focusedBorderColor = Gold, unfocusedBorderColor = Sf2, cursorColor = Gold))
        LazyColumn(Modifier.weight(1f)) {
            items(list, key = { it.id }) { b ->
                Row(Modifier.fillMaxWidth().clickable { open(b) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Cover(b, Modifier.size(56.dp, 84.dp).clip(RoundedCornerShape(6.dp)))
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(b.title, color = Tx, fontSize = 16.sp, maxLines = 2)
                        Text(b.author, color = Mute, fontSize = 13.sp, maxLines = 1)
                        Text(fmt(b.durationMs), color = Mute, fontSize = 13.sp)
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
    LaunchedEffect(vm.playing) { while (vm.playing) { vm.tick(); delay(500) } }
    Column(Modifier.fillMaxSize().background(Bg).statusBarsPadding().navigationBarsPadding().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween) {
            TextButton(close) { Text("←", color = Tx, fontSize = 24.sp) }
            TextButton({ queue = true }) { Text("☰", color = Gold, fontSize = 22.sp) }
        }
        Cover(b, Modifier.fillMaxWidth(.8f).aspectRatio(1f).shadow(24.dp, RoundedCornerShape(18.dp)).clip(RoundedCornerShape(18.dp)))
        Spacer(Modifier.height(18.dp))
        Text(b.title, color = Tx, fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2)
        Text(b.author, color = Gold2, fontSize = 16.sp)
        Text("Глава ${vm.index + 1} из ${vm.tracks.size}", color = Mute, fontSize = 14.sp)
        Spacer(Modifier.weight(1f))
        Slider(if (vm.dur > 0) vm.pos.toFloat() / vm.dur else 0f, { vm.seek((it * vm.dur).toLong()) },
            colors = SliderDefaults.colors(thumbColor = Gold, activeTrackColor = Gold, inactiveTrackColor = Sf2))
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween) { Text(fmt(vm.pos), color = Mute, fontSize = 13.sp); Text("−" + fmt(vm.dur - vm.pos), color = Mute, fontSize = 13.sp) }
        Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), Arrangement.SpaceEvenly, Alignment.CenterVertically) {
            TextButton({ vm.skip(-15_000) }) { Text("↺ 15", color = Tx, fontSize = 20.sp) }
            Box(Modifier.size(76.dp).clip(CircleShape).background(Gold).clickable { vm.toggle() }, contentAlignment = Alignment.Center) {
                Text(if (vm.playing) "❚❚" else "▶", color = OnGold, fontSize = 26.sp)
            }
            TextButton({ vm.skip(15_000) }) { Text("15 ↻", color = Tx, fontSize = 20.sp) }
        }
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceEvenly) {
            TextButton({ vm.cycleSpeed() }) { Text("${vm.speed}×", color = Tx) }
            TextButton({ vm.cycleSleep() }) { Text(if (vm.sleepMin > 0) "⏰ ${vm.sleepMin} мин" else "⏰ Таймер", color = if (vm.sleepMin > 0) Gold else Tx) }
            TextButton({ vm.cycleBoost() }) { Text("🔊 +${vm.boostMb / 100} дБ", color = if (vm.boostMb > 0) Gold else Tx) }
        }
    }
    if (queue) AlertDialog(onDismissRequest = { queue = false }, containerColor = Sf, confirmButton = { TextButton({ queue = false }) { Text("Закрыть", color = Gold) } },
        title = { Text("Главы", color = Tx) }, text = {
            LazyColumn { items(vm.tracks) { t -> Text("${t.idx + 1}. ${t.title}", Modifier.fillMaxWidth().clickable { vm.jump(t.idx); queue = false }.padding(vertical = 10.dp),
                color = if (t.idx == vm.index) Gold else Tx) } }
        })
}

@Composable
fun Folders(vm: VM, close: () -> Unit) {
    LaunchedEffect(Unit) { vm.loadFolders() }
    Column(Modifier.fillMaxSize().background(Bg).statusBarsPadding().navigationBarsPadding().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Text("Выбор папок", color = Tx, fontSize = 22.sp, fontWeight = FontWeight.SemiBold); TextButton(close) { Text("✕", color = Mute, fontSize = 20.sp) }
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), Arrangement.SpaceBetween) { Text("Папки с музыкой", color = Tx); Text("${vm.selected.size} выбрано", color = Mute) }
        if (vm.folders.isEmpty()) Text("Аудиофайлы не найдены или нет доступа к медиафайлам", Modifier.weight(1f).padding(16.dp), color = Mute)
        else LazyColumn(Modifier.weight(1f)) {
            items(vm.folders, key = { it.path }) { f ->
                Row(Modifier.fillMaxWidth().clickable { vm.toggleFolder(f.path) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(f.path in vm.selected, { vm.toggleFolder(f.path) }, colors = CheckboxDefaults.colors(checkedColor = Gold, checkmarkColor = OnGold, uncheckedColor = Mute))
                    Text("📁", fontSize = 24.sp); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) { Text(f.path.substringAfterLast('/'), color = Tx); Text(f.path, color = Mute, fontSize = 12.sp, maxLines = 1) }
                    Text("${f.count}", color = Mute)
                }
            }
        }
        val sel = vm.folders.filter { it.path in vm.selected }
        Text("Будет просканировано: ${sel.size} папок", color = Mute, fontSize = 13.sp)
        Text("Найдено аудиофайлов: ${sel.sumOf { it.count }}", color = Mute, fontSize = 13.sp)
        Text("MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV, WMA", color = Mute, fontSize = 12.sp, modifier = Modifier.padding(bottom = 10.dp))
        Button({ vm.scan(); close() }, Modifier.fillMaxWidth().height(52.dp), enabled = sel.isNotEmpty(),
            colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = OnGold)) { Text("Начать сканирование", fontWeight = FontWeight.SemiBold) }
    }
}

@Composable
fun Settings(vm: VM, folders: () -> Unit) {
    @Composable fun Sec(t: String) = Text(t, Modifier.padding(top = 22.dp, bottom = 6.dp), color = Mute, fontSize = 14.sp)
    @Composable fun Item(t: String, s: String, click: () -> Unit) = Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Sf).clickable { click() }.padding(16.dp), Arrangement.SpaceBetween) {
        Column { Text(t, color = Tx); Text(s, color = Mute, fontSize = 13.sp) }; Text("›", color = Mute, fontSize = 20.sp)
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(16.dp)) {
        Text("Настройки", color = Tx, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
        Sec("Хранилище"); Item("Выбранные папки", "${vm.selected.size} папок", folders)
        Spacer(Modifier.height(8.dp)); Item("Пересканировать", vm.scanning ?: "Обновить библиотеку") { vm.scan() }
        Sec("Внешний вид")
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Sf).padding(16.dp), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Column { Text("3D полка", color = Tx); Text("Реалистичный наклон книг", color = Mute, fontSize = 13.sp) }
            Switch(vm.threeD, { vm.set3d(it) }, colors = SwitchDefaults.colors(checkedTrackColor = Gold, checkedThumbColor = OnGold))
        }
        Sec("О приложении"); Item("Версия", "0.1") {}
    }
}
