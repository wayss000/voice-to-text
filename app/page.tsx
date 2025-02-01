'use client'
import React, { useState } from 'react'
import { AudioRecorder } from '@/components/AudioRecorder'
import { ResultDisplay } from '@/components/ResultDisplay'
import { HistoryList } from '@/components/HistoryList'

interface HistoryItem {
  id: string
  text: string
  timestamp: string
  success: boolean
  error?: string
}

export default function Home() {
  const [result, setResult] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])

  const handleRecordingComplete = async (audioBlob: Blob) => {
    setIsLoading(true)
    setError('')
    
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.wav')

      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData
      })

      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error)
      }

      setResult(result.text)
      
      // 添加到历史记录
      setHistory(prev => [{
        id: Date.now().toString(),
        text: result.text,
        timestamp: result.timestamp,
        success: true
      }, ...prev])

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '转换失败，请重试'
      setError(errorMessage)
      console.error('Conversion failed:', err)
      
      // 添加错误记录到历史
      setHistory(prev => [{
        id: Date.now().toString(),
        text: '',
        timestamp: new Date().toISOString(),
        success: false,
        error: errorMessage
      }, ...prev])
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      // 可以添加一个提示
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-3xl font-bold text-center mb-8">语音转文字</h1>
      
      <div className="space-y-8">
        <AudioRecorder onRecordingComplete={handleRecordingComplete} />
        <ResultDisplay 
          text={result}
          isLoading={isLoading}
          error={error}
        />
        <HistoryList 
          items={history}
          onCopy={handleCopy}
        />
      </div>
    </main>
  )
} 