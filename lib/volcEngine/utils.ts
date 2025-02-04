import { WaveFile } from 'wavefile'

// WaveFile 类型定义
interface WaveFmt {
  numChannels: number
  bitsPerSample: number
  sampleRate: number
  numSamples: number  // 添加这个字段
}

interface WaveFileType {
  fmt: WaveFmt
}

// WAV 信息读取函数
export interface WavInfo {
  nchannels: number
  sampwidth: number
  framerate: number
  nframes: number
}

export function readWavInfo(data: Buffer): WavInfo {
  try {
    const wav = new WaveFile(data) as WaveFileType
    return {
      nchannels: wav.fmt.numChannels,
      sampwidth: wav.fmt.bitsPerSample / 8,
      framerate: wav.fmt.sampleRate,
      nframes: wav.fmt.numSamples
    }
  } catch (error) {
    console.error('读取WAV信息失败:', error)
    throw error
  }
}

export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numberOfChannels = 1
  const sampleRate = 16000
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numberOfChannels * bytesPerSample
  
  const wavData = new ArrayBuffer(44 + buffer.length * bytesPerSample)
  const view = new DataView(wavData)
  
  /* RIFF identifier */
  writeString(view, 0, 'RIFF')
  /* RIFF chunk length */
  view.setUint32(4, 36 + buffer.length * bytesPerSample, true)
  /* RIFF type */
  writeString(view, 8, 'WAVE')
  /* format chunk identifier */
  writeString(view, 12, 'fmt ')
  /* format chunk length */
  view.setUint32(16, 16, true)
  /* sample format (raw) */
  view.setUint16(20, 1, true)
  /* channel count */
  view.setUint16(22, numberOfChannels, true)
  /* sample rate */
  view.setUint32(24, sampleRate, true)
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * blockAlign, true)
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, blockAlign, true)
  /* bits per sample */
  view.setUint16(34, bitsPerSample, true)
  /* data chunk identifier */
  writeString(view, 36, 'data')
  /* data chunk length */
  view.setUint32(40, buffer.length * bytesPerSample, true)
  
  const samples = new Float32Array(buffer.getChannelData(0))
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
    offset += 2
  }
  
  return wavData
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
} 