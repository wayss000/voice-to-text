'use client'
import React, { useState } from 'react'
import styles from './styles.module.css'

interface ResultDisplayProps {
  text: string
  isLoading?: boolean
  error?: string
}

export function ResultDisplay({ text, isLoading = false, error }: ResultDisplayProps) {
  const [copySuccess, setCopySuccess] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
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
          disabled={!text || isLoading}
        >
          {copySuccess ? '已复制' : '复制文本'}
        </button>
      </div>

      <textarea
        id="result"
        value={text}
        readOnly
        placeholder="转换后的文本将显示在这里..."
        className={styles['result-textarea']}
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