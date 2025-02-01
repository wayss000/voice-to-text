import { NextRequest, NextResponse } from 'next/server'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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
    console.log('Audio file type:', audioFile.type)
    console.log('Audio buffer size:', audioBuffer.length)

    // 保存临时文件
    await writeFile(tempPath, audioBuffer)

    try {
      // 直接调用 Python 脚本
      const { stdout, stderr } = await execAsync(`python api/offical_demo.py`)
      
      if (stderr) {
        console.error('Python script error:', stderr)
        throw new Error(stderr)
      }

      // 获取最后一行（JSON 数据）
      const lastLine = stdout.trim().split('\n').pop() || ''
      const result = JSON.parse(lastLine)
      return NextResponse.json({
        success: true,
        text: result.result.payload_msg.result[0].text,
        timestamp: new Date().toISOString()
      })

    } finally {
      // 删除临时文件
      try {
        await unlink(tempPath)
      } catch (e) {
        console.error('Failed to delete temp file:', e)
      }
    }

  } catch (error) {
    console.error('Conversion error:', error)
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