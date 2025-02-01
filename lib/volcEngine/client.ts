import { gzip } from 'pako'
import { v4 as uuidv4 } from 'uuid'
import { readFile } from 'fs/promises'
import { 
  generateFullDefaultHeader, 
  generateAudioDefaultHeader,
  generateLastAudioDefaultHeader,
  parseResponse 
} from './protocol'
import type { Config, RequestParams } from './types'
import { WaveFile } from 'wavefile'

const WebSocket = require('ws').WebSocket

export class VolcEngineClient {
  private readonly config: {
    appId: string
    token: string
    cluster: string
    wsUrl: string
    segDuration: number
    format: string
  }

  constructor(config: Config) {
    this.config = {
      wsUrl: 'wss://openspeech.bytedance.com/api/v2/asr',
      segDuration: 15000,  // 15 seconds
      format: 'wav',
      ...config
    }
  }

  async convertFile(filePath: string): Promise<string> {
    // 1. 读取文件
    const audioData = await readFile(filePath)
    
    // 2. 读取 WAV 信息
    const { nchannels, sampwidth, framerate, nframes } = await this.readWavInfo(audioData)
    
    // 3. 计算分片大小
    const sizePerSec = nchannels * sampwidth * framerate
    const segmentSize = Math.floor(sizePerSec * this.config.segDuration / 1000)

    // 4. 处理音频数据
    const result = await this.processAudioData(audioData, segmentSize)
    
    // 5. 解析结果
    if (result.payload_msg?.code !== 1000) {
      throw new Error(result.payload_msg?.message || '转换失败')
    }

    return result.payload_msg?.result?.[0]?.text || ''
  }

  private async readWavInfo(data: Buffer) {
    try {
      const wav = new WaveFile(data)
      console.log('WAV Info:', {
        channels: wav.fmt.numChannels,
        sampleRate: wav.fmt.sampleRate,
        bitsPerSample: wav.fmt.bitsPerSample
      })
      return {
        nchannels: wav.fmt.numChannels,
        sampwidth: wav.fmt.bitsPerSample / 8,
        framerate: wav.fmt.sampleRate,
        nframes: wav.fmt.numSamples
      }
    } catch (error) {
      console.error('Failed to read WAV info:', error)
      throw error
    }
  }

  private async processAudioData(audioData: Buffer, segmentSize: number) {
    const ws = new WebSocket(this.config.wsUrl, {
      headers: { 'Authorization': `Bearer; ${this.config.token}` },
      rejectUnauthorized: false
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('WebSocket connection timeout'))
      }, 30000) // 30秒超时

      ws.on('open', async () => {
        try {
          // 1. 发送初始请求
          const reqid = uuidv4()
          const requestParams = this.constructRequest(reqid)
          const payloadBytes = Buffer.from(JSON.stringify(requestParams))
          const compressedPayload = Buffer.from(gzip(payloadBytes))
          
          const sizeBuffer = Buffer.alloc(4)
          sizeBuffer.writeInt32BE(compressedPayload.length)
          
          const fullClientRequest = Buffer.concat([
            Buffer.from(generateFullDefaultHeader()),
            sizeBuffer,
            compressedPayload
          ])
          
          await new Promise((res, rej) => {
            ws.send(fullClientRequest, (error) => {
              if (error) rej(error)
              else res(null)
            })
          })

          // 2. 分片发送音频数据
          for (const [chunk, last] of this.sliceData(audioData, segmentSize)) {
            const compressedChunk = Buffer.from(gzip(chunk))
            const header = last ? generateLastAudioDefaultHeader() : generateAudioDefaultHeader()
            const sizeBuffer = Buffer.alloc(4)
            sizeBuffer.writeInt32BE(compressedChunk.length)
            
            const audioRequest = Buffer.concat([
              Buffer.from(header),
              sizeBuffer,
              compressedChunk
            ])

            await new Promise((res, rej) => {
              ws.send(audioRequest, (error) => {
                if (error) rej(error)
                else res(null)
              })
            })
          }
        } catch (error) {
          reject(error)
        }
      })

      ws.on('message', (data) => {
        const response = parseResponse(Buffer.from(data as Buffer))
        if (response.payload_msg?.code !== 1000) {
          reject(new Error(response.payload_msg?.message || '转换失败'))
          return
        }
        resolve(response)
      })

      ws.on('error', reject)

      ws.on('close', () => {
        clearTimeout(timeout)
      })
    })
  }

  private constructRequest(reqid: string): RequestParams {
    return {
      app: {
        appid: this.config.appId,
        cluster: this.config.cluster,
        token: this.config.token,
      },
      user: {
        uid: 'streaming_asr_demo'
      },
      request: {
        reqid,
        nbest: 1,
        workflow: 'audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate',
        show_language: false,
        show_utterances: false,
        result_type: 'full',
        sequence: 1
      },
      audio: {
        format: this.config.format,
        rate: 16000,
        language: 'zh-CN',
        bits: 16,
        channel: 1,
        codec: 'raw'
      }
    }
  }

  private *sliceData(data: Buffer, chunkSize: number): Generator<[Buffer, boolean]> {
    const dataLen = data.length
    let offset = 0
    while (offset + chunkSize < dataLen) {
      yield [data.slice(offset, offset + chunkSize), false]
      offset += chunkSize
    }
    yield [data.slice(offset, dataLen), true]
  }
} 