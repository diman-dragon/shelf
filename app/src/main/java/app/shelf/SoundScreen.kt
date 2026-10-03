package app.shelf

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.shelf.dsp.Dsp
import app.shelf.dsp.Profiles

/**
 * Экран «Звук» (раздел 5 ТЗ): кривая EQ с 10 перетаскиваемыми точками, спектр, индикатор уровня,
 * секции «Громкость», «Тембр», «Воспроизведение», «Профили». Анализ рисуется только на открытом экране.
 */
@OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
fun SoundScreen(onBack: () -> Unit, bookId: Long = Profiles.currentBook) {
    val st = Dsp.state
    var refresh by remember { mutableIntStateOf(0) }
    // обновление графика ~30 FPS, пока экран открыт (п. 5.3); на переднем плане
    LaunchedEffect(Unit) {
        Dsp.processor?.spectrumEnabled = true
        while (true) { kotlinx.coroutines.delay(33); refresh++ }
    }
    DisposableEffect(Unit) { onDispose { Dsp.processor?.spectrumEnabled = false } }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← Назад", color = Gold2) }
            Spacer(Modifier.weight(1f))
            Text("Звук", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold))
            Spacer(Modifier.weight(1f)); Spacer(Modifier.width(64.dp))
        }

        // ---- кривая отклика + спектр + точки EQ ----
        EqCurve(st.eq, Modifier.fillMaxWidth().height(200.dp).background(Sf2, RoundedCornerShape(12.dp)).padding(8.dp))
        LevelRow(refresh)

        // ---- пресеты ----
        Text("Пресёты", color = Mute, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
            listOf("Плоский", "Голос", "Бас", "Музыка", "Чёткость").forEach { p ->
                OutlinedButton({ applyPreset(p) }, contentPadding = PaddingValues(horizontal = 10.dp)) { Text(p, fontSize = 12.sp, color = Gold2) }
            }
        }

        Section("Громкость") {
            LabeledSlider("Усиление ${st.boostPercent}%", if (st.boostPercent > 200 && !st.hearingProtection) "Выше 200% включите лимитер" else null) { v ->
                st.boostPercent = (v * 300f + 100f).toInt() / 5 * 5 // 100–400%, шаг 5%
            }
            SwitchRow("Нормализация (ReplayGain −18 LUFS)", st.normalize) { st.normalize = it }
            SwitchRow("Авто-уровень (AGC)", st.agcOn) { st.agcOn = it; if (it) st.normalize = false } // выкл., если есть нормализация
            SwitchRow("Защита слуха (RMS > −12 дБ)", st.hearingProtection) { st.hearingProtection = it }
        }
        Section("Тембр") {
            SwitchRow("Voice clarity (2–4 кГц + де-эссер)", st.voiceClarity) { st.voiceClarity = it }
            SwitchRow("Бас-энхансер (до 110 Гц)", st.bassEnhancer) { st.bassEnhancer = it }
            SwitchRow("HighPass 20 Гц", st.hp20) { st.hp20 = it }
            SwitchRow("Шумодав (срез шипения)", st.noiseGate) { st.noiseGate = it }
        }
        Section("Воспроизведение") {
            SwitchRow("Кроссфид (Bauer)", st.crossfeed) { st.crossfeed = it }
            SwitchRow("Моно", st.mono) { st.mono = it }
            LabeledSlider("Баланс L/R %.2f".format(st.balance), null) { st.balance = it * 2f - 1f }
            SwitchRow("Обмен каналов", st.swapChannels) { st.swapChannels = it }
            SwitchRow("Компрессор (режим «Макс. громкость» 4:1)", st.compressor) { st.compressor = it }
            SwitchRow("A/B «Чистый звук» — вся обработка кроме усиления off", st.pureBypass) { st.pureBypass = it }
        }
        Section("Профили") {
            Text("Профиль сохраняется для книги и отдельно для типа выхода (наушники/динамик/Bluetooth).", color = Mute, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                Button(onClick = { Profiles.saveCurrent(bookId) }) { Text("Сохранить для книги", fontSize = 13.sp) }
                OutlinedButton({ Profiles.loadFor(bookId) }) { Text("Загрузить", fontSize = 13.sp, color = Gold2) }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}


fun applyPreset(name: String) {
    val g: FloatArray = when (name) {
        "Плоский" -> FloatArray(10)
        "Голос" -> floatArrayOf(-4f, -3f, -1f, 1f, 3f, 4f, 4f, 2f, 0f, -2f)
        "Бас" -> floatArrayOf(7f, 6f, 4f, 1f, 0f, 0f, 0f, 1f, 2f, 3f)
        "Музыка" -> floatArrayOf(3f, 2f, 0f, -1f, -1f, 0f, 2f, 3f, 3f, 2f)
        else -> floatArrayOf(-2f, -1f, 0f, 2f, 4f, 5f, 5f, 4f, 2f, 0f) // Чёткость
    }
    Dsp.state.eq.setAll(g)
}

@Composable private fun Section(t: String, content: @Composable ColumnScope.() -> Unit) {
    Text(t, color = Gold2, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
    Column(Modifier.fillMaxWidth().background(Sf2, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 4.dp), content = content)
}

@Composable private fun SwitchRow(t: String, v: Boolean, on: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(t, color = Tx, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Switch(v, on, colors = SwitchDefaults.colors(checkedThumbColor = Gold2, checkedTrackColor = Gold.copy(alpha = .4f)))
    }
}

@Composable private fun LabeledSlider(label: String, warn: String?, value: Float = -1f, onValue: (Float) -> Unit) {
    Column {
        Text(label, color = Tx, fontSize = 14.sp)
        warn?.let { Text(it, color = Err, fontSize = 12.sp) }
        val cur = if (value >= 0f) value else currentFrac(label)
        Slider(cur, { onValue(it) }, Modifier.height(36.dp),
            colors = SliderDefaults.colors(thumbColor = Gold2, activeTrackColor = Gold2))
    }
}
private fun currentFrac(label: String): Float = when {
    label.startsWith("Усиление") -> ((Dsp.state.boostPercent - 100) / 300f).coerceIn(0f, 1f)
    else -> ((Dsp.state.balance + 1f) / 2f).coerceIn(0f, 1f)
}

/** Кривая EQ: 10 точек, drag по вертикали = ±15 дБ; под кривой — полупрозрачный спектр (п. 5.3). */
/** Кривая EQ: 10 точек, перетаскивание по вертикали = ±15 дБ; под кривой — спектр (п. 5.3). */
@Composable private fun EqCurve(eq: app.shelf.dsp.Equalizer10, mod: Modifier) {
    var drag by remember { mutableIntStateOf(-1) }
    Canvas(mod = mod.pointerInput(Unit) {
        awaitPointerEventScope {
            while (true) {
                val e = awaitPointerEvent()
                val p0 = e.changes.firstOrNull() ?: continue
                if (e.type == androidx.compose.ui.input.pointer.PointerEventType.Press) {
                    val w = size.width.toFloat(); val h = size.height.toFloat()
                    var best = -1; var bd = 1e9f
                    for (i in 0 until 10) {
                        val x = bandX(i, w); val y = dbY(eq.gainsDb[i], h)
                        val d = (p0.position.x - x) * (p0.position.x - x) + (p0.position.y - y) * (p0.position.y - y)
                        if (d < bd) { bd = d; best = i }
                    }
                    drag = if (bd < 90f * 90f) best else -1
                } else if (e.type == androidx.compose.ui.input.pointer.PointerEventType.Move && drag >= 0) {
                    val h = size.height.toFloat()
                    eq.setGain(drag, ((h / 2 - p0.position.y) / (h / 2) * 15f))
                    p0.consume()
                } else if (e.type == androidx.compose.ui.input.pointer.PointerEventType.Release) {
                    drag = -1
                }
            }
        }
    }) {
        val w = size.width; val h = size.height
        drawLine(Color.White.copy(alpha = .12f), Offset(0f, h / 2), Offset(w, h / 2), 1f) // 0 дБ
        val spec = Dsp.processor?.lastSpectrum
        if (spec != null) {
            val pts = mutableListOf<Offset>()
            for (b in spec.indices) {
                val x = w * (b + 0.5f) / spec.size
                val y = h / 2 - (spec[b] + 90f) / 90f * (h / 2)
                pts += Offset(x, y.coerceIn(0f, h))
            }
            drawPath(fillPath(pts, h), Color(0x33E0B060))
        }
        val curve = (0..100).map { i ->
            val f = 20f * (1000f).pow(i / 100f); val x = freqX(f, w)
            Offset(x, dbY(eq.responseDbAt(f), h))
        }
        drawPath(androidx.compose.ui.graphics.Path().apply {
            moveTo(curve.first().x, curve.first().y); curve.forEach { lineTo(it.x, it.y) }
        }, Gold2, style = androidx.compose.ui.graphics.drawscope.Stroke(3f))
        for (i in 0 until 10) drawCircle(if (drag == i) Gold else Gold2, 10f, Offset(bandX(i, w), dbY(eq.gainsDb[i], h)))
    }
}
private fun fillPath(pts: List<Offset>, h: Float): androidx.compose.ui.graphics.Path =
    androidx.compose.ui.graphics.Path().apply {
        if (pts.isEmpty()) return this
        moveTo(pts.first().x, h); pts.forEach { lineTo(it.x, it.y) }; lineTo(pts.last().x, h); close()
    }
private fun bandX(i: Int, w: Float) = w * (i + 0.5f) / 10f
private fun dbY(db: Float, h: Float) = h / 2 - db / 15f * (h / 2)
private fun freqX(f: Float, w: Float): Float { // лог-шкала 20 Гц – 20 кГц
    val t = (Math.log(f / 20.0) / Math.log(1000.0)).toFloat().coerceIn(0f, 1f)
    return w * t
}

/** Индикатор уровня: пик, RMS, срабатывание лимитера; красный при клиппинге (п. 5.3). */
@Composable private fun LevelRow(refresh: Int) {
    val p = Dsp.processor
    val peak = p?.levelPeak ?: 0f
    val rms = p?.levelRms ?: 0f
    val lim = p?.limiting ?: false
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
        Text("Пик", color = Mute, fontSize = 12.sp, modifier = Modifier.width(48.dp))
        Box(Modifier.weight(1f).height(8.dp).background(Sf, RoundedCornerShape(4.dp))) {
            Canvas(Modifier.fillMaxSize()) {
                drawRoundRect(color = if (peak > 0.98f) Err else Gold2, topLeft = Offset(0f, 0f),
                    size = androidx.compose.ui.geometry.Size(size.width * peak.coerceIn(0f, 1f), size.height),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(8f, 8f))
            }
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("RMS", color = Mute, fontSize = 12.sp, modifier = Modifier.width(48.dp))
        Box(Modifier.weight(1f).height(8.dp).background(Sf, RoundedCornerShape(4.dp))) {
            Canvas(Modifier.fillMaxSize()) {
                drawRoundRect(color = Gold.copy(alpha = .7f), topLeft = Offset(0f, 0f),
                    size = androidx.compose.ui.geometry.Size(size.width * rms.coerceIn(0f, 1f), size.height),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(8f, 8f))
            }
        }
        if (lim) Text(" LIMIT", color = Err, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}
