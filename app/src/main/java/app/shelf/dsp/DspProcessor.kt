package app.shelf.dsp

import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.BaseAudioProcessor
import java.nio.ByteBuffer

/**
 * AudioProcessor ExoPlayer (ТЗ 5.1): декодер → сюда → AudioTrack.
 * Работает в PCM 16-bit; внутри — float-цепочка DspState.
 * Спектр для визуализации (п. 5.3) снимается с последнего блока, только когда экран «Звук» открыт.
 */
@UnstableApi
class DspProcessor(val dsp: DspState) : BaseAudioProcessor() {

    @Volatile var spectrumEnabled = false
    @Volatile var lastSpectrum: FloatArray? = null   // 64 бинa, дБ, лог-шкала
    @Volatile var levelPeak = 0f
    @Volatile var levelRms = 0f
    @Volatile var limiting = false

    private var channels = 2

    override fun onQueueInputBuffer(buffer: ByteBuffer) {}

    // BaseAudioProcessor сам сообщает выходной формат через Specification в configure();
    // дополнительные getOutputChannels/getOutputSampleRate переопределять не нужно.

    override fun isActive(): Boolean = dsp.anyEffect || spectrumEnabled

    override fun configure(inputSampleRate: Int, inputChannelCount: Int, output: Specification) {
        channels = inputChannelCount.coerceAtLeast(1)
        if (dsp.sr != inputSampleRate.toFloat()) dsp.applySampleRate(inputSampleRate.toFloat())
        output.setFormat(inputSampleRate, channels)
    }

    override fun transformBuffer(input: ByteBuffer, output: ByteBuffer) {
        val sr = inputSampleRate
        val n = input.remaining() / 2
        if (n <= 0) { output.put(input); return }
        val f = FloatArray(n)
        val mark = input.position()
        for (i in 0 until n) f[i] = input.short.toInt() / 32768f
        input.position(mark)

        val monoIn = channels == 1
        val work = if (monoIn) FloatArray(n * 2).also { for (i in 0 until n) { it[2 * i] = f[i]; it[2 * i + 1] = f[i] } } else f
        val processed = dsp.process(work)
        val out = if (monoIn) FloatArray(n).also { for (i in 0 until n) it[i] = processed[2 * i] } else processed

        // запись обратно в 16-bit
        output.clear(); output.limit(output.capacity())
        for (i in 0 until n) {
            var v = out[i]
            if (v > 1f) v = 1f; if (v < -1f) v = -1f
            output.putShort((v * 32767f).toInt().toShort())
        }
        output.flip()

        levelPeak = dsp.meter.peak; levelRms = dsp.meter.rms
        if (spectrumEnabled) lastSpectrum = fftSpectrum(out, sr, bins = 64)
    }

    /** Простой БПФ через DFT по 64 логарифмическим корзинам 20 Гц – 20 кГц (анализ только при открытом экране). */
    private fun fftSpectrum(buf: FloatArray, sr: Int, bins: Int): FloatArray {
        val step = maxOf(1, buf.size / 1024)
        val win = FloatArray(minOf(1024, buf.size / step))
        for (i in win.indices) win[i] = buf[i * step]
        val out = FloatArray(bins)
        val fMin = 20f; val fMax = minOf(20000f, sr / 2f)
        for (b in 0 until bins) {
            val fc = fMin * (fMax / fMin).pow((b + 0.5f) / bins)
            val k = 2 * Math.PI * fc / sr
            var re = 0.0; var im = 0.0
            val stride = maxOf(1, (sr / fc / 8).toInt()) // режем точки, чтобы не грузить CPU
            var j = 0
            while (j < win.size) {
                val w = 0.54 - 0.46 * Math.cos(2 * Math.PI * j / (win.size - 1)) // Hamming
                re += win[j] * w * Math.cos(k * j * step); im -= win[j] * w * Math.sin(k * j * step)
                j += stride
            }
            val m = Math.hypot(re, im) / (win.size / stride + 1)
            out[b] = (20 * Math.log10(maxOf(m, 1e-7))).toFloat().coerceIn(-90f, 0f)
        }
        return out
    }

    override fun endOfStream() {}
    override fun reset() { super.reset() }
}
