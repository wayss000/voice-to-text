'use client'
import React, { useState, useEffect } from 'react'
import styles from './styles.module.css'

interface ResultDisplayProps {
  text: string
  isLoading?: boolean
  error?: string
  onTextChange?: (newText: string) => void
}

export function ResultDisplay({ 
  text, 
  isLoading = false, 
  error,
  onTextChange 
}: ResultDisplayProps) {
  const [editableText, setEditableText] = useState(text)
  const [copySuccess, setCopySuccess] = useState(false)

  useEffect(() => {
    setEditableText(text)
  }, [text])

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    setEditableText(newText)
    onTextChange?.(newText)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editableText)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed to copy text:', err)
    }
  }

  return (
    <div className={styles['result-area']}>
      <div className={styles['result-header']}>
        <span>转换结果</span>
        <button 
          onClick={handleCopy}
          className={styles['copy-button']}
          disabled={!editableText || isLoading}
        >
          {copySuccess ? '已复制' : '复制文本'}
        </button>
      </div>

      <textarea
        value={editableText}
        onChange={handleTextChange}
        placeholder="转换后的文本将显示在这里..."
        className={styles['result-textarea']}
        disabled={isLoading}
      />

      {isLoading && (
        <div className={styles['status-message']}>
          正在转换中...
        </div>
      )}

      {error && (
        <div className={`${styles['status-message']} ${styles.error}`}>
          {error}
        </div>
      )}
    </div>
  )
} 