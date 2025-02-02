import { gzip } from 'pako'
import { v4 as uuidv4 } from 'uuid'
import { readFile } from 'fs/promises'
import { WaveFile } from 'wavefile'
import { 
  generateFullDefaultHeader, 
  generateAudioDefaultHeader,
  generateLastAudioDefaultHeader,
  parseResponse 
} from './protocol'
import type { Config, RequestParams } from './types'
import WebSocket from 'ws'

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
    console.log('开始处理音频文件:', filePath)
    
    // 1. 读取文件
    const audioData = await readFile(filePath)
    
    // 2. 读取 WAV 信息
    const { nchannels, sampwidth, framerate, nframes } = await this.readWavInfo(audioData)
    console.log('音频信息:', { nchannels, sampwidth, framerate, nframes })
    
    // 3. 计算分片大小
    const sizePerSec = nchannels * sampwidth * framerate
    const segmentSize = Math.floor(sizePerSec * this.config.segDuration / 1000)
    console.log('分片大小:', segmentSize)

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

  private async processAudioData(audioData: Buffer, segmentSize: number) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.wsUrl, {
        headers: { 
          'Authorization': `Bearer; ${this.config.token}`
        },
        rejectUnauthorized: false,
        timeout: 30000,  // 添加超时设置
        handshakeTimeout: 30000
      })

      // 设置二进制类型
      ws.binaryType = 'nodebuffer'

      ws.on('open', async () => {
        try {
          console.log('WebSocket连接已建立，准备发送初始请求...')
          
          // 1. 发送初始请求
          const reqid = uuidv4()
          const requestParams = this.constructRequest(reqid)
          console.log('请求参数:', JSON.stringify(requestParams, null, 2))

          const payloadBytes = Buffer.from(JSON.stringify(requestParams))
          const compressedPayload = Buffer.from(gzip(payloadBytes))
          
          const sizeBuffer = Buffer.alloc(4)
          sizeBuffer.writeInt32BE(compressedPayload.length)
          
          const fullClientRequest = Buffer.concat([
            Buffer.from(generateFullDefaultHeader()),
            sizeBuffer,
            compressedPayload
          ])

          // 添加发送选项
          ws.send(fullClientRequest, {
            binary: true,
            compress: false,  // 禁用压缩
            fin: true,  // 表示这是完整的消息
            mask: true  // 启用掩码
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

            ws.send(audioRequest)
          }
          
        } catch (error) {
          console.error('处理音频数据时发生错误:', error)
          ws.close()
          reject(error)
        }
      })

      ws.on('message', (data) => {
        try {
          console.log('收到WebSocket消息，开始解析...')
          const response = parseResponse(Buffer.from(data as Buffer))
          console.log('解析后的响应:', JSON.stringify(response, null, 2))
          
          if (response.payload_msg?.code !== 1000) {
            console.error('收到错误响应:', response.payload_msg)
            ws.close()
            reject(new Error(response.payload_msg?.message || '转换失败'))
            return
          }

          if (response.payload_msg?.result?.[0]?.text) {
            const result = response.payload_msg.result[0].text
            console.log('成功获取识别结果:', result)
            ws.close()
            resolve(response)
          } else {
            console.log('收到中间响应，继续等待最终结果...')
          }
        } catch (error) {
          console.error('解析响应时发生错误:', error)
          ws.close()
          reject(error)
        }
      })

      ws.on('error', (error) => {
        console.error('WebSocket发生错误:', error)
        ws.close()
        reject(error)
      })

      ws.on('close', (code, reason) => {
        console.log('WebSocket连接关闭:', { code, reason: reason.toString() })
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