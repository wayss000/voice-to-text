'use client'
import React, { useState, useRef, useEffect } from 'react'
import { audioBufferToWav } from '@/lib/volcEngine/utils'
import styles from './styles.module.css'  // 导入CSS Module

interface AudioRecorderProps {
  onRecordingComplete?: (audioBlob: Blob) => void
}

export function AudioRecorder({ onRecordingComplete }: AudioRecorderProps) {
  // 状态管理
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState('00:00')
  
  // refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const timeIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number>(0)
  const audioChunksRef = useRef<Blob[]>([])
  
  // 开始录音
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,        // 单声道
          sampleRate: 16000,      // 采样率 16kHz
          sampleSize: 16,         // 采样大小 16bit
        } 
      })
      
      // 检查支持的 MIME 类型
      const mimeType = MediaRecorder.isTypeSupported('audio/wav')
        ? 'audio/wav'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/webm;codecs=pcm'

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      console.log('Using MIME type:', mimeType)  // 添加日志
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        // 获取录音数据
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType })
        
        // 转换为 WAV 格式
        const wavBlob = await convertToWav(audioBlob)
        handleRecordingComplete(wavBlob)
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      startTimeRef.current = Date.now()
      setIsRecording(true)
      startTimer()
    } catch (error) {
      console.error('Error starting recording:', error)
    }
  }

  // 停止录音
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      stopTimer()
    }
  }

  // 处理录音按钮点击
  const handleRecordClick = () => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  // 更新计时器显示
  const updateTimer = () => {
    const time = Date.now() - startTimeRef.current
    const seconds = Math.floor(time / 1000)
    const minutes = Math.floor(seconds / 60)
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
    setRecordingTime(formattedTime)
  }

  // 启动计时器
  const startTimer = () => {
    timeIntervalRef.current = setInterval(updateTimer, 1000)
  }

  // 停止计时器
  const stopTimer = () => {
    if (timeIntervalRef.current) {
      clearInterval(timeIntervalRef.current)
      timeIntervalRef.current = null
    }
  }

  const handleRecordingComplete = async (audioBlob: Blob) => {
    try {
      // 创建 FormData
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.wav')

      // 调用 API
      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData
      })

      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || '转换失败')
      }

      // 调用父组件的回调
      onRecordingComplete?.(audioBlob)
      
      return result
    } catch (error) {
      console.error('Failed to convert audio:', error)
      throw error
    }
  }

  // 清理副作用
  useEffect(() => {
    return () => {
      stopTimer()
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

  return (
    <div className={styles['record-area']}>
      <button 
        className={`${styles['record-button']} ${isRecording ? styles.recording : ''}`}
        onClick={handleRecordClick}
      >
        <span className={styles['record-icon']}></span>
        <span className={styles['record-text']}>
          {isRecording ? '停止录音' : '开始录音'}
        </span>
      </button>
      
      <div className={styles['record-time']}>
        <span>{recordingTime}</span>
      </div>
      
      <div className={styles['record-tip']}>
        点击按钮开始录音，再次点击结束录音并开始转换
      </div>
    </div>
  )
}

async function convertToWav(blob: Blob): Promise<Blob> {
  // 创建 AudioContext
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  
  // 读取音频数据
  const arrayBuffer = await blob.arrayBuffer()
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
  
  // 创建 WAV 格式数据
  const numberOfChannels = 1
  const sampleRate = 16000
  const bitsPerSample = 16
  
  // 重采样和格式转换
  const offlineContext = new OfflineAudioContext(
    numberOfChannels,
    audioBuffer.duration * sampleRate,
    sampleRate
  )
  
  const source = offlineContext.createBufferSource()
  source.buffer = audioBuffer
  source.connect(offlineContext.destination)
  source.start()
  
  const renderedBuffer = await offlineContext.startRendering()
  
  // 转换为 WAV Blob
  const wavData = audioBufferToWav(renderedBuffer)
  return new Blob([wavData], { type: 'audio/wav' })
} 