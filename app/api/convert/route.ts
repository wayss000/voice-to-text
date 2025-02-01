import { NextRequest, NextResponse } from 'next/server'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { VolcEngineClient } from '@/lib/volcEngine/client'

// 配置信息
const config = {
  appId: process.env.VOLC_APP_ID || "4673182595",
  token: process.env.VOLC_TOKEN || "9UwX58oSkTVpQVXV-1Uwok6tcQWPot8U",
  cluster: process.env.VOLC_CLUSTER || "volcengine_input_common"
}

export async function POST(request: NextRequest) {
  const tempPath = join(process.cwd(), 'temp_audio_test.wav')
  
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File
    
    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: '没有收到音频文件' },
        { status: 400 }
      )
    }

    // 将 File 对象转换为 Buffer
    const arrayBuffer = await audioFile.arrayBuffer()
    const audioBuffer = Buffer.from(arrayBuffer)

    // 添加调试日志
    console.log('音频文件类型:', audioFile.type)
    console.log('音频数据大小:', audioBuffer.length)

    // 保存临时文件
    await writeFile(tempPath, audioBuffer)

    try {
      // 使用 TypeScript 实现的客户端
      const client = new VolcEngineClient(config)
      const text = await client.convertFile(tempPath)

      return NextResponse.json({
        success: true,
        text,
        timestamp: new Date().toISOString()
      })

    } finally {
      // 删除临时文件
      try {
        await unlink(tempPath)
      } catch (e) {
        console.error('删除临时文件失败:', e)
      }
    }

  } catch (error) {
    console.error('转换失败:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : '转换失败，请重试',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
} 