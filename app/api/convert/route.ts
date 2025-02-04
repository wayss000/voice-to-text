import { NextRequest, NextResponse } from 'next/server'
import { VolcEngineClient } from '@/lib/volcEngine/client'

// 配置信息
const config = {
  appId: process.env.VOLC_APP_ID || "4673182595",
  token: process.env.VOLC_TOKEN || "9UwX58oSkTVpQVXV-1Uwok6tcQWPot8U",
  cluster: process.env.VOLC_CLUSTER || "volcengine_input_common"
}

export const runtime = 'nodejs'  // 使用 Node.js 运行时
export const maxDuration = 60    // 60 秒超时

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File
    
    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: '没有收到音频文件' },
        { status: 400 }
      )
    }

    // 添加类型检查和调试日志
    console.log('收到的文件:', {
      name: audioFile.name,
      type: audioFile.type,
      size: audioFile.size
    })

    // 确保文件不为空
    if (audioFile.size === 0) {
      return NextResponse.json(
        { success: false, error: '文件内容为空' },
        { status: 400 }
      )
    }

    // 检查文件类型
    if (!audioFile.type.includes('audio/')) {
      return NextResponse.json(
        { success: false, error: '不支持的文件类型' },
        { status: 400 }
      )
    }

    // 安全地转换为 Buffer
    let audioBuffer: Buffer;
    try {
      const arrayBuffer = await audioFile.arrayBuffer()
      audioBuffer = Buffer.from(arrayBuffer)
      
      // 验证 Buffer
      if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error('Buffer 转换失败')
      }
      
      console.log('音频数据大小:', audioBuffer.length)
    } catch (error) {
      console.error('文件处理失败:', error)
      return NextResponse.json(
        { success: false, error: '文件处理失败' },
        { status: 400 }
      )
    }

    // 处理音频
    const client = new VolcEngineClient(config)
    const text = await client.convertBuffer(audioBuffer)

    return NextResponse.json({
      success: true,
      text,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('请求处理失败:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : '请求处理失败，请重试',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
} 