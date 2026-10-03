package app.shelf.dsp

import kotlin.math.*

/**
 * Собственный аудиодвижок (раздел 5 ТЗ): цепочка обработчиков в float, блоки = размер буфера.
 * Узлы, которые выключены, пропускаются без затрат (process() не трогает буфер).
 */

private const val SQRT2 = 1.41421356237f

/** Биквад (Direct Form I), коэффициенты по Audio EQ Cookbook (RBJ). */
class Biquad {
    var b0 = 1f; var b1 = 0f; var b2 = 0f; var a1 = 0f; var a2 = 0f
    private var x1 = 0f; private var x2 = 0f; private var y1 = 0f; private var y2 = 0f

    fun setPeaking(fc: Float, sr: Float, gainDb: Float, q: Float = SQRT2) {
        val w = 2 * PI.toFloat() * fc / sr; val cw = cos(w); val sw = sin(w)
        val A = 10f.pow(gainDb / 40f); val alpha = sw / (2 * q)
        val d = 1 + alpha
        b0 = (1 + alpha * A) / d; b1 = 2 * (1 - A) / d; b2 = (1 - alpha * A) / d
        a1 = -2 * (1 - alpha) / d; a2 = (1 - alpha) / d; reset()
    }
    fun setLowShelf(fc: Float, sr: Float, gainDb: Float) = shelf(fc, sr, gainDb, low = true)
    fun setHighShelf(fc: Float, sr: Float, gainDb: Float) = shelf(fc, sr, gainDb, low = false)
    private fun shelf(fc: Float, sr: Float, gainDb: Float, low: Boolean) {
        val w = 2 * PI.toFloat() * fc / sr; val cw = cos(w); val sw = sin(w)
        val A = 10f.pow(gainDb / 40f)
        val aa = sqrt(A) * sw // Q = √2/2 → sqrt(A)·sin(w0)
        val d = (A + 1) + (A - 1) * cw + aa
        if (low) {
            b0 = A * ((A + 1) - (A - 1) * cw + aa) / d
            b1 = 2 * A * ((A - 1) - (A + 1) * cw) / d
            b2 = A * ((A + 1) - (A - 1) * cw - aa) / d
        } else {
            b0 = ((A + 1) + (A - 1) * cw + aa) / d
            b1 = -2 * ((A - 1) + (A + 1) * cw) / d
            b2 = ((A + 1) + (A - 1) * cw - aa) / d
        }
        a1 = -2 * ((A - 1) + (A + 1) * cw) / d
        a2 = ((A + 1) + (A - 1) * cw - aa) / d; reset()
    }
    fun setPassHz(fc: Float, sr: Float) { // high-pass 2-го порядка (20 Гц)
        val w = 2 * PI.toFloat() * fc / sr; val cw = cos(w); val sw = sin(w)
        val alpha = sw / (2 * SQRT2); val d = 1 + alpha
        b0 = (1 + cw) / 2 / d; b1 = -(1 + cw) / d; b2 = b0
        a1 = -2 * cw / d; a2 = (1 - alpha) / d; reset()
    }
    fun reset() { x1 = 0f; x2 = 0f; y1 = 0f; y2 = 0f }
    /** Обработка interleaved-канала: старт k=ch, шаг stride=channels. */
    fun process(x: FloatArray, ch: Int, n: Int, stride: Int) {
        for (i in 0 until n) {
            val k = i * stride + ch
            if (k >= x.size) break
            val xi = x[k]; val yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = xi; y2 = y1; y1 = yi; x[k] = yi
        }
    }
}

/** Эквалайзер 10 полос: shelf на краях (31 и 16 кГц), peaking в середине (ТЗ 5.2). */
class Equalizer10(val freqs: FloatArray = floatArrayOf(31f, 62f, 125f, 250f, 500f, 1000f, 2000f, 4000f, 8000f, 16000f)) {
    val gainsDb = FloatArray(10)
    private val bands = Array(10) { Biquad() }
    private var sr = 0f
    var enabled = false; private set
    /** Сумма максимального подъёма — для pre-amp (автокомпенсация). */
    val maxGainDb get() = gainsDb.maxOrNull()?.coerceAtLeast(0f) ?: 0f

    fun setSampleRate(rate: Float) { sr = rate; rebuild() }
    fun setGain(i: Int, db: Float) { gainsDb[i] = db.coerceIn(-15f, 15f); if (sr > 0) rebuild() }
    fun setAll(db: FloatArray) { for (i in gainsDb.indices) gainsDb[i] = db[i].coerceIn(-15f, 15f); if (sr > 0) rebuild() }
    private fun rebuild() {
        enabled = gainsDb.any { abs(it) > 0.05f }
        for (i in gainsDb.indices) {
            val g = gainsDb[i]; val f = freqs[i]
            when (i) {
                0 -> bands[i].setLowShelf(f, sr, g)
                9 -> bands[i].setHighShelf(f, sr, g)
                else -> bands[i].setPeaking(f, sr, g)
            }
        }
    }
    fun process(buf: FloatArray, channels: Int) {
        if (!enabled || sr == 0f) return
        val n = buf.size / channels
        for (b in bands) for (c in 0 until channels) b.process(buf, c, n, channels)
    }
    /** Теоретическая АЧХ для графика (п. 5.3): каскад |H(f)| в дБ. */
    fun responseDbAt(freq: Float): Float {
        if (!enabled || sr == 0f) return 0f
        var sum = 0f
        for (i in gainsDb.indices) if (abs(gainsDb[i]) > 0.05f) sum += magDb(bands[i], freq)
        return sum.coerceIn(-24f, 24f)
    }
    private fun magDb(b: Biquad, f: Float): Float {
        val w = 2 * PI.toFloat() * f / sr; val c1 = cos(w); val c2 = cos(2 * w); val s1 = sin(w); val s2 = sin(2 * w)
        val re = b.b0 + b.b1 * c1 + b.b2 * c2; val im = -(b.b1 * s1 + b.b2 * s2)
        val dr = 1 + b.a1 * c1 + b.a2 * c2; val di = -(b.a1 * s1 + b.a2 * s2)
        val m = (re * re + im * im) / (dr * dr + di * di + 1e-12f)
        return (10 * log10(m.toDouble())).toFloat()
    }
}

/** Мягкий клиппер + лимитер с атакой/слиянием; потолок −1 dBTP ≈ 0.89; чистая зона до 0.7 (ТЗ 5.2). */
class ClipLimiter(private var ceiling: Float = 0.89f) {
    var limiterOn = true
    private var env = 0f
    private val attack = 0.2f; private val release = 0.005f
    var lastPeak = 0f; private set
    var limiting = false; private set

    fun setCeilingDb(db: Float) { ceiling = 10f.pow(db / 20f) }
    fun process(buf: FloatArray) {
        limiting = false; var peak = 0f
        for (i in buf.indices) {
            var x = buf[i]
            if (limiterOn) {
                val a = abs(x)
                env = if (a > env) env + attack * (a - env) else env + release * (a - env)
                if (env > ceiling) {
                    val over = env / ceiling
                    x = x / (1f + (over - 1f) * 0.7f) // мягкое ограничение выше потолка
                    limiting = true
                }
                if (x > 1f || x < -1f) x = tanh(x.toDouble()).toFloat()
            }
            val ax = abs(x); if (ax > peak) peak = ax
            buf[i] = x
        }
        lastPeak = peak
    }
}

/** Контроль уровня: RMS/пик для индикатора и защиты слуха (5.2). */
class LevelMeter {
    var rms = 0f; private set
    var peak = 0f; private set
    fun process(buf: FloatArray) {
        var s = 0.0; var p = 0f
        for (x in buf) { s += (x * x).toDouble(); val ax = abs(x); if (ax > p) p = ax }
        val r = sqrt((s / (buf.size + 1))).toFloat()
        rms += 0.3f * (r - rms); peak = maxOf(p, peak * 0.95f)
    }
    val rmsDb get() = 20 * log10(rms.toDouble().coerceAtLeast(1e-9)).toFloat()
}

/** Настройки всей цепочки — обновляются из UI, читаются процессором каждый блок. */
class DspState {
    val eq = Equalizer10()
    var preAmpDb = 0f                  // автокомпенсация EQ
    var boostPercent = 100             // усиление 100–400% (шаг 5%)
    var normalize = false              // ReplayGain книги (EBU R128, цель −18 LUFS)
    var replayGainFactor = 1f
    var mono = false
    var balance = 0f                   // −1..1
    var swapChannels = false
    var voiceClarity = false           // подъём 2–4 кГц + де-эссер 6–8 кГц
    var bassEnhancer = false           // гармоники до 110 Гц
    var crossfeed = false              // Bauer
    var hearingProtection = false      // RMS > −12 dBFS дольше 1.5 с → снижение до −9 дБ
    var agcOn = false                  // авто-уровень S (выключается при нормализации)
    var noiseGate = false              // шумодав C: срез шипения + приглушение пауз
    var compressor = false             // компрессор S: −24 дБ, 2:1 (4:1 при «Макс. громкость»)
    var pureBypass = false             // A/B «Чистый звук»: всё кроме усиления
    @Volatile var sleepToZero = false  // таймер сна: сервис плавно гасит громкость и ставит паузу
    var limiterCeilingDb = -1f
    var hp20 = false                   // HighPass 20 Гц
    var sr = 44100f

    private val hp = Biquad()
    private val vcUp = Biquad(); private val deEss = Biquad(); private val bassHp = Biquad(); private val hiss = Biquad()
    val limiter = ClipLimiter()
    val meter = LevelMeter()

    fun applySampleRate(rate: Float) {
        sr = rate; eq.setSampleRate(rate)
        hp.setPassHz(20f, rate)
        vcUp.setPeaking(3000f, rate, 4f, 1.0f); deEss.setPeaking(7000f, rate, -4f, 1.4f)
        bassHp.setPassHz(110f, rate); hiss.setPeaking(8500f, rate, -6f, 1.2f)
    }
    fun updatePreAmp() { preAmpDb = -(eq.maxGainDb).coerceAtMost(0f) }

    val anyEffect get() = !pureBypass && (eq.enabled || boostPercent != 100 || normalize || mono || balance != 0f ||
            swapChannels || voiceClarity || bassEnhancer || crossfeed || hp20 || noiseGate || compressor || agcOn)

    /** Обработка interleaved-буфера (L,R,L,R...). Тот же массив. */
    fun process(buf: FloatArray): FloatArray {
        val n = buf.size
        if (n == 0) return buf
        val ch = 2
        if (pureBypass) { applyBoost(buf); limiter.process(buf); meter.process(buf); return buf }
        if (hp20) for (c in 0 until ch) hp.process(buf, c, n / ch, ch)
        if (normalize && replayGainFactor != 1f) scale(buf, replayGainFactor)
        updatePreAmp()
        if (preAmpDb < -0.05f) scaleDb(buf, preAmpDb)
        eq.process(buf, ch)
        if (noiseGate) applyNoiseGate(buf)
        if (voiceClarity) for (c in 0 until ch) { vcUp.process(buf, c, n / ch, ch); deEss.process(buf, c, n / ch, ch) }
        if (bassEnhancer) applyBass(buf)
        if (crossfeed) applyCrossfeed(buf)
        if (swapChannels) for (i in 0 until n / ch) { val t = buf[2 * i]; buf[2 * i] = buf[2 * i + 1]; buf[2 * i + 1] = t }
        if (mono || balance != 0f) applyMonoBalance(buf)
        if (compressor) applyCompressor(buf)
        if (agcOn && !normalize) applyAgc(buf)
        applyBoost(buf)
        limiter.setCeilingDb(limiterCeilingDb)
        limiter.process(buf)
        protect(buf)
        meter.process(buf)
        return buf
    }

    private fun scale(buf: FloatArray, f: Float) { for (i in buf.indices) buf[i] *= f }
    private fun scaleDb(buf: FloatArray, db: Float) { scale(buf, 10f.pow(db / 20f)) }
    private fun applyBoost(buf: FloatArray) { if (boostPercent != 100) scale(buf, boostPercent / 100f) }

    private var gateEnv = 0f
    private fun applyNoiseGate(buf: FloatArray) {
        for (c in 0 until 2) hiss.process(buf, c, buf.size / 2, 2)
        var pk = 0f; for (x in buf) { val ax = abs(x); if (ax > pk) pk = ax }
        gateEnv += (if (pk > 0.02f) 0.5f else -0.05f) * (1f - gateEnv) // открытие быстрое, закрытие медленное
        val g = 0.15f + 0.85f * gateEnv.coerceIn(0f, 1f)
        for (i in buf.indices) buf[i] *= g
    }

    private var compGain = 1f
    private fun applyCompressor(buf: FloatArray) {
        val ratio = if (boostPercent > 200) 4f else 2f   // «Макс. громкость» — 4:1
        val thr = 10f.pow(-24f / 20f)
        for (i in buf.indices) {
            val x = buf[i]; val a = abs(x)
            val target = if (a > thr) (thr * (a / thr).pow(1f / ratio)) / a else 1f
            compGain += 0.1f * (target - compGain)       // мягкое колено через сглаживание
            buf[i] = x * compGain
        }
    }

    private var agcGain = 1f
    private fun applyAgc(buf: FloatArray) {
        var s = 0.0; for (x in buf) s += (x * x).toDouble()
        val rms = sqrt((s / (buf.size + 1))).toFloat()
        val want = if (rms > 1e-5f) (0.1f / rms).coerceIn(10f.pow(-3f / 20f), 10f.pow(12f / 20f)) else agcGain
        agcGain += 0.02f * (want - agcGain)              // сглаживание ≈1 с
        for (i in buf.indices) buf[i] *= agcGain
    }

    private fun applyBass(buf: FloatArray) {
        // генерация субгармоник: НЧ-полоса (<110 Гц) проходит квадратичную дисторсию и добавляется к сигналу
        val tmp = buf.copyOf()
        for (c in 0 until 2) bassHp.process(tmp, c, tmp.size / 2, 2)
        for (i in buf.indices) buf[i] += 0.35f * (tmp[i] * abs(tmp[i]))
    }
    private fun applyCrossfeed(buf: FloatArray) {
        // упрощённый Bauer: немного противоположного канала между ушами
        for (i in 0 until buf.size / 2) {
            val l = buf[2 * i]; val r = buf[2 * i + 1]
            buf[2 * i] = l - 0.15f * r; buf[2 * i + 1] = r - 0.15f * l
        }
    }
    private fun applyMonoBalance(buf: FloatArray) {
        val gl = if (balance <= 0) 1f else 1f - balance
        val gr = if (balance >= 0) 1f else 1f + balance
        for (i in 0 until buf.size / 2) {
            val l = buf[2 * i]; val r = buf[2 * i + 1]
            if (mono) { val m = (l + r) * 0.5f; buf[2 * i] = m * gl; buf[2 * i + 1] = m * gr }
            else { buf[2 * i] = l * gl; buf[2 * i + 1] = r * gr }
        }
    }

    // защита слуха: RMS выше −12 dBFS дольше 1.5 с → плавное снижение до −9 дБ
    private var overTime = 0f
    private var protGain = 1f
    private fun protect(buf: FloatArray) {
        if (!hearingProtection) { protGain = 1f; overTime = 0f; return }
        if (meter.rmsDb > -12f) overTime += buf.size / (sr * 2) else overTime = max(0f, overTime - 0.1f)
        val target = if (overTime > 1.5f) 10f.pow(-9f / 20f) else 1f
        protGain += 0.01f * (target - protGain)
        if (protGain < 0.999f) scale(buf, protGain)
    }
}

/** Профили звука (5.2): для книги и для типа выхода. Хранение — JSON в SharedPreferences. */
object Profiles {
    data class Snap(val eq: FloatArray, val boost: Int, val normalize: Boolean, val mono: Boolean,
                    val balance: Float, val voice: Boolean, val bass: Boolean, val crossfeed: Boolean,
                    val hp20: Boolean, val gate: Boolean, val comp: Boolean, val agc: Boolean, val prot: Boolean)

    fun snapshot(): Snap {
        val s = Dsp.state
        return Snap(s.eq.gainsDb.copyOf(), s.boostPercent, s.normalize, s.mono, s.balance,
            s.voiceClarity, s.bassEnhancer, s.crossfeed, s.hp20, s.noiseGate, s.compressor, s.agcOn, s.hearingProtection)
    }
    fun restore(p: Snap) {
        val s = Dsp.state
        s.eq.setAll(p.eq); s.boostPercent = p.boost; s.normalize = p.normalize; s.mono = p.mono
        s.balance = p.balance; s.voiceClarity = p.voice; s.bassEnhancer = p.bass; s.crossfeed = p.crossfeed
        s.hp20 = p.hp20; s.noiseGate = p.gate; s.compressor = p.comp; s.agcOn = p.agc; s.hearingProtection = p.prot
    }
    @Volatile var currentBook: Long = 0L
    fun saveCurrent(bookId: Long) = store("p_$bookId", encode(snapshot()))
    fun loadFor(bookId: Long) { decode(store("p_$bookId"))?.let { restore(it) } }
    private fun encode(p: Snap): String = org.json.JSONObject().apply {
        put("eq", org.json.JSONArray(p.eq.toList())); put("boost", p.boost); put("norm", p.normalize)
        put("mono", p.mono); put("bal", p.balance); put("vc", p.voice); put("bass", p.bass)
        put("xf", p.crossfeed); put("hp", p.hp20); put("gate", p.gate); put("comp", p.comp); put("agc", p.agc); put("prot", p.prot)
    }.toString()
    private fun decode(j: String?): Snap? = j?.let { runCatching {
        val o = org.json.JSONObject(it)
        Snap(FloatArray(10) { o.getJSONArray("eq").getDouble(it).toFloat() }, o.getInt("boost"), o.getBoolean("norm"),
            o.getBoolean("mono"), o.getDouble("bal").toFloat(), o.getBoolean("vc"), o.getBoolean("bass"),
            o.getBoolean("xf"), o.getBoolean("hp"), o.getBoolean("gate"), o.getBoolean("comp"), o.getBoolean("agc"), o.getBoolean("prot"))
    }.getOrNull() }
    private fun store(key: String, value: String? = null): String? {
        if (!::ctx.isInitialized) return null
        val sp = ctx.getSharedPreferences("profiles", 0)
        return if (value != null) { sp.edit().putString(key, value).apply(); value } else sp.getString(key, null)
    }
    lateinit var ctx: android.content.Context
}
