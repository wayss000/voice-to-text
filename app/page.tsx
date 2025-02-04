'use client'
import React, { useState, useEffect } from 'react'
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

const STORAGE_KEY = 'voice_to_text_history'

const saveHistory = (history: HistoryItem[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch (err) {
    console.error('Failed to save history:', err)
  }
}

const loadHistory = (): HistoryItem[] => {
  if (typeof window === 'undefined') return []  // 服务端返回空数组
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : []
  } catch (err) {
    console.error('Failed to load history:', err)
    return []
  }
}

export default function Home() {
  const [result, setResult] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory())  // 改回之前的方式

  useEffect(() => {
    const isInitialRender = history.length === 0 && !localStorage.getItem(STORAGE_KEY)
    if (!isInitialRender) {
      saveHistory(history)
    }
  }, [history])

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
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleTextChange = (newText: string) => {
    setResult(newText)
    setHistory(prev => {
      if (prev.length === 0) return prev
      return [{
        ...prev[0],
        text: newText
      }, ...prev.slice(1)]
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 标题区域 */}
      <header className="w-full bg-white shadow-sm">
        <div className="max-w-3xl mx-auto px-4">
          <h1 className="text-3xl font-bold text-gray-900 text-center py-6">
            语音转文字
          </h1>
        </div>
      </header>

      {/* 主要内容区域 */}
      <main className="container mx-auto px-4 py-8 max-w-full">
        <div className="max-w-3xl mx-auto space-y-8">
          <AudioRecorder onRecordingComplete={handleRecordingComplete} />
          <ResultDisplay 
            text={result}
            isLoading={isLoading}
            error={error}
            onTextChange={handleTextChange}
          />
          <HistoryList 
            items={history}
            onCopy={handleCopy}
          />
        </div>
      </main>
    </div>
  )
} 